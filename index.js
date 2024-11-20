const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const fs = require("fs");

const app = express();
app.use(bodyParser.json());

const VERIFY_TOKEN = "my_verify_token";
const APP_ID = "497657243241828"; // App ID
const APP_SECRET = "6f6668bec23b20a09790e34f2d142f64"; // App Secret
let USER_ACCESS_TOKEN = "EAAHEnds0DWQBO0uzyeR2HxOeZByf3ZAcy4n27szvVQbP8XnJ3xyPd9aBRrvzGxZCeYL6S6qwIUFZBv1xRQV15GCtAWtvuViJ9OxUHtjmAab2oDz867rwzCM3L3hZCFKf2mZCKfiWoAK73BUlgb7igXHz5wCNy0ZB9e77e9moa5czHNZBMIwIA7LhN6QvQKwTy6eOwtwV6He6QZAKZCfSyGXgZDZD"; // Short-lived token

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

// Function to Refresh Access Token
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

// Verify Webhook
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

// Handle Webhook Events
app.post("/webhook", async (req, res) => {
  const body = req.body;

  if (body.object === "page") {
    for (const entry of body.entry) {
      for (const change of entry.changes) {
        if (change.field === "leadgen") {
          const { leadgen_id: leadgenId } = change.value;
          try {
            const leadData = await getLeadData(leadgenId);
            console.log("Lead Data:", JSON.stringify(leadData, null, 2));
          } catch (error) {
            console.error("Error fetching lead data:", error.message);
          }
        }
      }
    }
    res.status(200).send("EVENT_RECEIVED");
  } else {
    res.status(404).send("Not Found");
  }
});

// Fetch Lead Data
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
      return getLeadData(leadgenId); // Retry with refreshed token
    }
    throw error;
  }
};

// Fetch All Pages, Forms, and Leads
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
        }

        if (leads.length > 0) {
          const latestLeadTime = leads[leads.length - 1].created_time;
          lastFetchedTime = new Date(latestLeadTime).toISOString();
          saveLastFetchedTime();
          console.log(`Updated lastFetchedTime to: ${lastFetchedTime}`);
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
