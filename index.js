const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const fs = require("fs");

const app = express();
app.use(bodyParser.json()); // Parse incoming request bodies as JSON

const VERIFY_TOKEN = "my_verify_token";
const APP_ID = "497657243241828"; // App ID from your screenshot
const APP_SECRET = "6f6668bec23b20a09790e34f2d142f64"; // App secret from your screenshot

let USER_ACCESS_TOKEN =
  "EAAHEnds0DWQBO5BpFeEmoqDLFK2PZCayVQYwWZBaPzX9zE69EH9IKv78M13qWPVneAdhBGgFSWSfORoOz92fSqrSzZARH5Fa4St6atOeDYZAijpkrxPcfZA05aCZCXTiMpP7rrGQSAtFG8m2RLkJAcSgrZA750BBcpRUOUCODA7R7lLpZAfQuke7kg2IAye7jHa4tjGp12XZC6zROPZCMERJYZD"; // Replace with your provided short-lived token

// Track the last fetched time for leads
let lastFetchedTime = null;

// Load last fetched time from a file (persistent storage)
const loadLastFetchedTime = () => {
  if (fs.existsSync("lastFetchedTime.txt")) {
    lastFetchedTime = fs.readFileSync("lastFetchedTime.txt", "utf-8");
  } else {
    lastFetchedTime = null; // If no file, start with null
  }
};

// Save last fetched time to a file (persistent storage)
const saveLastFetchedTime = () => {
  fs.writeFileSync("lastFetchedTime.txt", lastFetchedTime);
};

// Refresh short-lived token to long-lived token
const refreshAccessToken = async () => {
  try {
    console.log("Refreshing access token...");
    const response = await axios.get(
      `https://graph.facebook.com/v17.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${APP_ID}&client_secret=${APP_SECRET}&fb_exchange_token=${USER_ACCESS_TOKEN}`
    );

    USER_ACCESS_TOKEN = response.data.access_token;
    console.log("Access token refreshed successfully:", USER_ACCESS_TOKEN);
  } catch (error) {
    console.error("Error refreshing access token:", error.response?.data || error.message);
    throw new Error("Failed to refresh access token.");
  }
};

// Verify the Webhook when Meta sends a GET request
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === VERIFY_TOKEN) {
    console.log("Webhook verified successfully.");
    res.status(200).send(challenge);
  } else {
    console.error("Webhook verification failed.");
    res.status(403).send("Verification failed");
  }
});

// Listen for POST requests from Meta
app.post("/webhook", async (req, res) => {
  const body = req.body;

  if (body.object === "page") {
    console.log("Webhook event received for 'page' object.");
    for (const entry of body.entry) {
      console.log(`Processing entry: ${JSON.stringify(entry, null, 2)}`);
      for (const change of entry.changes) {
        if (change.field === "leadgen") {
          const { leadgen_id: leadgenId } = change.value;
          console.log(`Received leadgen ID: ${leadgenId}`);

          try {
            const leadData = await getLeadData(leadgenId);
            console.log("Lead Data Fetched:", JSON.stringify(leadData, null, 2));
          } catch (error) {
            console.error("Error fetching lead data:", error.response?.data || error.message);
          }
        }
      }
    }
    res.status(200).send("EVENT_RECEIVED");
  } else {
    console.error("Webhook event object is not 'page'. Ignoring.");
    res.status(404).send("Nothing Found");
  }
});

// Fetch Lead Data by Lead ID
const getLeadData = async (leadgenId) => {
  try {
    console.log(`Fetching lead data for Leadgen ID: ${leadgenId}`);
    const response = await axios.get(
      `https://graph.facebook.com/v17.0/${leadgenId}?access_token=${USER_ACCESS_TOKEN}`
    );
    return response.data;
  } catch (error) {
    if (error.response?.data?.error?.code === 190) {
      console.log("Access token expired. Refreshing token...");
      await refreshAccessToken();
      return getLeadData(leadgenId); // Retry after refreshing token
    }
    console.error("Error fetching lead data:", error.response?.data || error.message);
    throw new Error("Failed to fetch lead data.");
  }
};

// Fetch All Pages, Forms, and Leads
const fetchAllLeads = async () => {
  try {
    console.log("Fetching all pages linked to the user...");
    const pagesResponse = await axios.get(
      `https://graph.facebook.com/v17.0/me/accounts?fields=id,name,access_token&access_token=${USER_ACCESS_TOKEN}`
    );
    const pages = pagesResponse.data.data;

    console.log(`Found ${pages.length} pages. Fetching leads...`);

    for (const page of pages) {
      console.log(`Fetching forms for Page: ${page.name} (ID: ${page.id})`);
      const pageAccessToken = page.access_token;

      const formsResponse = await axios.get(
        `https://graph.facebook.com/v17.0/${page.id}/leadgen_forms?access_token=${pageAccessToken}`
      );
      const forms = formsResponse.data.data;

      console.log(`Found ${forms.length} forms for Page: ${page.name}.`);

      for (const form of forms) {
        console.log(`Fetching leads for Form ID: ${form.id}`);

        const params = {
          access_token: pageAccessToken,
          filtering: lastFetchedTime
            ? JSON.stringify([
                {
                  field: "created_time",
                  operator: "GREATER_THAN",
                  value: lastFetchedTime,
                },
              ])
            : undefined,
        };

        try {
          const leadsResponse = await axios.get(
            `https://graph.facebook.com/v17.0/${form.id}/leads`,
            { params }
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

            console.log("Fetched Lead Data:", JSON.stringify(leadData, null, 2));
          }

          if (leads.length > 0) {
            const latestLeadTime = leads[leads.length - 1].created_time;
            lastFetchedTime = new Date(latestLeadTime).toISOString();
            saveLastFetchedTime();
            console.log(`Updated lastFetchedTime to: ${lastFetchedTime}`);
          }
        } catch (error) {
          console.error("Error fetching leads:", error.response?.data || error.message);
        }
      }
    }
  } catch (error) {
    if (error.response?.data?.error?.code === 190) {
      console.log("Access token expired. Refreshing token...");
      await refreshAccessToken();
      return fetchAllLeads(); // Retry after refreshing token
    }
    console.error("Error fetching pages or leads:", error.response?.data || error.message);
  }
};

// Load last fetched time on server startup
loadLastFetchedTime();

// Start the Server
app.listen(5000, () => {
  console.log("Server is running on port 5000");
  fetchAllLeads(); // Optionally, fetch leads on startup
});
