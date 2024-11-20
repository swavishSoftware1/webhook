const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const fs = require("fs");

const app = express();
app.use(bodyParser.json());

const VERIFY_TOKEN = "my_verify_token";
const APP_ID = "497657243241828";
const APP_SECRET = "6f6668bec23b20a09790e34f2d142f64";
let USER_ACCESS_TOKEN = "EAAHEnds0DWQBO2Pyv9GZAnAUQPKZA4Q3uZCQTAX3DSVVJ9Ey6lziSZCmkJtUe0JEfiHwqD0AQ9AiZBQcT75rsvl0A8a00uTiOBWIKT60hoV6r4GQ8AK1264xiMdnTjz21NPZCWdE6JyRX0IbQZBzQYaCmSuxxa8E8ETgZC6NgIlrMZCuuiF7ZBgyCrCJWyZBoD0h6DKiM97nZCzCnS2Q4NKuswZDZD"; // Short-lived token

let lastFetchedTime = null;

const loadLastFetchedTime = () => {
  if (fs.existsSync("lastFetchedTime.txt")) {
    lastFetchedTime = fs.readFileSync("lastFetchedTime.txt", "utf-8");
    console.log("lastFetchedTime", lastFetchedTime);
  } else {
    lastFetchedTime = null;
  }
};

const saveLastFetchedTime = () => {
  fs.writeFileSync("lastFetchedTime.txt", lastFetchedTime);
};

const refreshAccessToken = async () => {
  try {
    console.log("Refreshing access token...");
    const response = await axios.get(
      `https://graph.facebook.com/v17.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${APP_ID}&client_secret=${APP_SECRET}&fb_exchange_token=${USER_ACCESS_TOKEN}`
    );
    USER_ACCESS_TOKEN = response.data.access_token;
    console.log("Access token refreshed:", USER_ACCESS_TOKEN);
  } catch (error) {
    console.error("Failed to refresh access token:", error.response?.data || error.message);
    throw new Error("Access token refresh failed.");
  }
};

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === VERIFY_TOKEN) {
    console.log("Webhook verified successfully.");
    res.status(200).send(challenge);
  } else {
    res.status(403).send("Verification failed.");
  }
});

app.post("/webhook", async (req, res) => {
  const body = req.body;

  if (body.object === "page") {
    for (const entry of body.entry) {
      for (const change of entry.changes) {
        if (change.field === "leadgen") {
          const { leadgen_id: leadgenId } = change.value;
          try {
            const leadData = await getLeadData(leadgenId);
            console.log("Lead Data (Facebook):", JSON.stringify(leadData, null, 2));
            console.log("Source: Facebook Page");
          } catch (error) {
            console.error("Error fetching lead data:", error.message);
          }
        }
      }
    }
  } else if (body.object === "whatsapp_business_account") {
    for (const entry of body.entry) {
      for (const message of entry.messages || []) {
        console.log("Lead Data (WhatsApp):", JSON.stringify(message, null, 2));
        console.log("Source: WhatsApp");
      }
    }
  } else if (body.object === "instagram") {
    for (const entry of body.entry) {
      for (const message of entry.messaging || []) {
        console.log("Lead Data (Instagram):", JSON.stringify(message, null, 2));
        console.log("Source: Instagram");
      }
    }
  }
  res.status(200).send("EVENT_RECEIVED");
});

const getLeadData = async (leadgenId) => {
  try {
    const response = await axios.get(
      `https://graph.facebook.com/v17.0/${leadgenId}?access_token=${USER_ACCESS_TOKEN}`
    );
    return response.data;
  } catch (error) {
    if (error.response?.data?.error?.code === 190) {
      console.log("Token expired. Refreshing token...");
      await refreshAccessToken();
      return getLeadData(leadgenId);
    }
    throw error;
  }
};

const fetchAllLeads = async () => {
  try {
    console.log("Fetching all pages linked to the user.");
    const pagesResponse = await axios.get(
      `https://graph.facebook.com/v17.0/me/accounts?fields=id,name,access_token&access_token=${USER_ACCESS_TOKEN}`
    );
    const pages = pagesResponse.data.data;

    console.log(`Found ${pages.length} pages. Fetching leads...`);

    for (const page of pages) {
      const pageAccessToken = page.access_token;
      console.log(`Fetching forms for Page: ${page.name} (ID: ${page.id})`);

      const formsResponse = await axios.get(
        `https://graph.facebook.com/v17.0/${page.id}/leadgen_forms?access_token=${pageAccessToken}`
      );
      const forms = formsResponse.data.data;

      console.log(`Found ${forms.length} forms for Page: ${page.name}.`);

      for (const form of forms) {
        console.log(`Fetching leads for Form ID: ${form.id}`);
        const leadsResponse = await axios.get(
          `https://graph.facebook.com/v17.0/${form.id}/leads?access_token=${pageAccessToken}`
        );
        const leads = leadsResponse.data.data;

        console.log(`Found ${leads.length} leads for Form ID: ${form.id}.`);

        for (const lead of leads) {
          const leadData = {
            pageId: page.id,
            pageName: page.name,
            formId: form.id,
            leadId: lead.id,
            createdTime: lead.created_time,
            fieldData: lead.field_data,
          };

          console.log(`Page: ${page.name} (ID: ${page.id})`);
          console.log("Fetched Lead Data:", JSON.stringify(leadData, null, 2));
          console.log("Source: Facebook Page");
        }
      }
    }
  } catch (error) {
    console.error("Error fetching pages, forms, or leads:", error.response?.data || error.message);
  }
};

loadLastFetchedTime();

app.listen(5000, () => {
  console.log("Server running on port 5000.");
  fetchAllLeads();
});
