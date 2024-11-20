const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const fs = require("fs");

const app = express();
app.use(bodyParser.json());

const VERIFY_TOKEN = "my_verify_token";
const APP_ID = "497657243241828"; // App ID
const APP_SECRET = "6f6668bec23b20a09790e34f2d142f64"; // App Secret
let USER_ACCESS_TOKEN = "EAAHEnds0DWQBO5BpFeEmoqDLFK2PZCayVQYwWZBaPzX9zE69EH9IKv78M13qWPVneAdhBGgFSWSfORoOz92fSqrSzZARH5Fa4St6atOeDYZAijpkrxPcfZA05aCZCXTiMpP7rrGQSAtFG8m2RLkJAcSgrZA750BBcpRUOUCODA7R7lLpZAfQuke7kg2IAye7jHa4tjGp12XZC6zROPZCMERJYZD"; // Short-lived token

let lastFetchedTime = null;

// Load the last fetched time from a file
const loadLastFetchedTime = () => {
  if (fs.existsSync("lastFetchedTime.txt")) {
    lastFetchedTime = fs.readFileSync("lastFetchedTime.txt", "utf-8");
    console.log("Loaded last fetched time:", lastFetchedTime);
  } else {
    lastFetchedTime = null;
  }
};

// Save the last fetched time to a file
const saveLastFetchedTime = () => {
  fs.writeFileSync("lastFetchedTime.txt", lastFetchedTime);
};

// Refresh Access Token
const refreshAccessToken = async () => {
  try {
    console.log("Refreshing access token...");
    const response = await axios.get(
      `https://graph.facebook.com/v17.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${APP_ID}&client_secret=${APP_SECRET}&fb_exchange_token=${USER_ACCESS_TOKEN}`
    );
    USER_ACCESS_TOKEN = response.data.access_token;
    console.log("Access token refreshed:", USER_ACCESS_TOKEN);
  } catch (error) {
    console.error("Error refreshing access token:", error.response?.data || error.message);
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
      console.log("Access token expired. Refreshing...");
      await refreshAccessToken();
      return getLeadData(leadgenId);
    }
    throw error;
  }
};

// Fetch All Pages, Forms, and Leads
const fetchAllLeads = async () => {
  try {
    console.log("Fetching all pages...");
    const pagesResponse = await axios.get(
      `https://graph.facebook.com/v17.0/me/accounts?fields=id,name,access_token&access_token=${USER_ACCESS_TOKEN}`
    );
    const pages = pagesResponse.data.data;

    for (const page of pages) {
      const pageAccessToken = page.access_token;
      console.log(`Fetching forms for Page: ${page.name}`);

      try {
        const formsResponse = await axios.get(
          `https://graph.facebook.com/v17.0/${page.id}/leadgen_forms?access_token=${pageAccessToken}`
        );
        const forms = formsResponse.data.data;

        for (const form of forms) {
          console.log(`Fetching leads for Form ID: ${form.id}`);

          let url = `https://graph.facebook.com/v17.0/${form.id}/leads?access_token=${pageAccessToken}`;
          if (lastFetchedTime) {
            url += `&filtering=[{"field":"created_time","operator":"GREATER_THAN","value":"${lastFetchedTime}"}]`;
          }

          try {
            const leadsResponse = await axios.get(url);
            const leads = leadsResponse.data.data;

            for (const lead of leads) {
              console.log("Lead:", JSON.stringify(lead, null, 2));
            }

            if (leads.length > 0) {
              lastFetchedTime = leads[leads.length - 1].created_time;
              saveLastFetchedTime();
            }
          } catch (leadError) {
            console.error("Error fetching leads:", leadError.response?.data || leadError.message);
          }
        }
      } catch (formError) {
        console.error("Error fetching forms:", formError.response?.data || formError.message);
      }
    }
  } catch (error) {
    if (error.response?.data?.error?.code === 190) {
      console.log("Access token expired. Refreshing...");
      await refreshAccessToken();
      return fetchAllLeads();
    }
    console.error("Error fetching pages:", error.response?.data || error.message);
  }
};

loadLastFetchedTime();

app.listen(5000, () => {
  console.log("Server running on port 5000.");
  fetchAllLeads();
});
