const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const crypto = require("crypto");
const fs = require("fs");

const app = express();
app.use(bodyParser.json());

// Configurations
const VERIFY_TOKEN = "my_verify_token"; // Replace with your webhook verification token
const APP_ID = "497657243241828"; // Your App ID
const APP_SECRET = "6f6668bec23b20a09790e34f2d142f64"; // Your App Secret
const PIXEL_ID = "500781749465576"; // Your Pixel ID
let USER_ACCESS_TOKEN =
  "EAAHEnds0DWQBO5081rvol3YOETWgDiNZBEEVIJJgoE0Ino5Uz8Nh5qTAvStTZAiBMxBFKf3TZCrsMZAACk5bquQuysjCcpEKnA3rAzRPHWXfxzqusJ5wbN6gDv1upRrJK0ZBgoVkjgjlZBhRZA9K71j6ktVn9LTZBH82TDP5mZCdDJBg2qkiMISX2zl8e"; // Replace with a valid token
const SYNC_FILE = "lastSyncTime.txt";

// Utility to hash data
const hashValue = (value) => crypto.createHash("sha256").update(value).digest("hex");

// Get last sync time
const getLastSyncTime = () => {
  if (fs.existsSync(SYNC_FILE)) {
    return parseInt(fs.readFileSync(SYNC_FILE, "utf8"), 10);
  }
  return null; // First run
};

// Save last sync time
const saveLastSyncTime = (time) => {
  fs.writeFileSync(SYNC_FILE, time.toString(), "utf8");
};

// Refresh or regenerate access token
const refreshAccessToken = async () => {
  try {
    console.log("Refreshing access token...");
    const response = await axios.get(`https://graph.facebook.com/v17.0/oauth/access_token`, {
      params: {
        grant_type: "fb_exchange_token",
        client_id: APP_ID,
        client_secret: APP_SECRET,
        fb_exchange_token: USER_ACCESS_TOKEN,
      },
    });
    USER_ACCESS_TOKEN = response.data.access_token;
    console.log("Access token refreshed successfully:", USER_ACCESS_TOKEN);
  } catch (error) {
    console.error("Failed to refresh access token:", error.response?.data || error.message);
    await regenerateAccessToken();
  }
};

const regenerateAccessToken = async () => {
  try {
    console.log("Regenerating a new access token...");
    const response = await axios.get(`https://graph.facebook.com/v17.0/oauth/access_token`, {
      params: {
        client_id: APP_ID,
        client_secret: APP_SECRET,
        grant_type: "client_credentials",
      },
    });
    USER_ACCESS_TOKEN = response.data.access_token;
    console.log("Access token regenerated successfully:", USER_ACCESS_TOKEN);
  } catch (error) {
    console.error("Failed to regenerate access token:", error.response?.data || error.message);
    throw new Error("Access token regeneration failed.");
  }
};

// Fetch Metadata for Pages, Campaigns, and Ads
const fetchMetadata = async (adId, adGroupId, pageId) => {
  try {
    const adResponse = await axios.get(`https://graph.facebook.com/v17.0/${adId}`, {
      params: { access_token: USER_ACCESS_TOKEN, fields: "name" },
    });
    const campaignResponse = await axios.get(`https://graph.facebook.com/v17.0/${adGroupId}`, {
      params: { access_token: USER_ACCESS_TOKEN, fields: "name" },
    });
    const pageResponse = await axios.get(`https://graph.facebook.com/v17.0/${pageId}`, {
      params: { access_token: USER_ACCESS_TOKEN, fields: "name,category" },
    });

    return {
      adName: adResponse.data.name || "Unknown Ad",
      campaignName: campaignResponse.data.name || "Unknown Campaign",
      pageName: pageResponse.data.name || "Unknown Page",
      pageCategory: pageResponse.data.category || "Unknown Category",
    };
  } catch (error) {
    console.error("Error fetching metadata:", error.response?.data || error.message);
    return { adName: "Unknown", campaignName: "Unknown", pageName: "Unknown", pageCategory: "Unknown" };
  }
};

// Fetch all leads for a form, optionally filtered by last sync time
const fetchLeads = async (formId, since = null) => {
  try {
    const params = { access_token: USER_ACCESS_TOKEN };

    if (since) {
      console.log(`Fetching leads created since: ${new Date(since * 1000).toISOString()}`);
      params.filtering = JSON.stringify([{ field: "time_created", operator: "GREATER_THAN", value: since }]);
    } else {
      console.log("Fetching all historical leads (first run).");
    }

    const response = await axios.get(`https://graph.facebook.com/v17.0/${formId}/leads`, { params });
    return response.data.data || [];
  } catch (error) {
    console.error("Error fetching leads:", error.response?.data || error.message);
    throw error;
  }
};

// Process Leads
const processLeads = async (leads, metadata, formName) => {
  for (const lead of leads) {
    try {
      console.log("Lead Data:", lead);
      console.log("Metadata:", metadata);
      console.log(`Form Name: ${formName}`);

      const parsedFields = {};
      lead.field_data.forEach((field) => {
        parsedFields[field.name] = field.values[0] || null;
      });

      console.log("Dynamic Fields:", parsedFields);
    } catch (error) {
      console.error("Error processing lead:", error.message);
    }
  }
};

// Fetch forms and their leads for a page
const fetchFormsAndLeads = async (pageId) => {
  try {
    const response = await axios.get(`https://graph.facebook.com/v17.0/${pageId}/leadgen_forms`, {
      params: { access_token: USER_ACCESS_TOKEN, fields: "id,name" },
    });

    console.log("Leadgen Forms Response:", JSON.stringify(response.data, null, 2)); // Debug forms response

    const forms = response.data.data || [];
    const lastSyncTime = getLastSyncTime();
    console.log("Last Sync Time:", lastSyncTime ? new Date(lastSyncTime * 1000).toISOString() : "First Run");

    const now = Math.floor(Date.now() / 1000); // Current timestamp in seconds

    if (forms.length === 0) {
      console.log(`No leadgen forms found for Page ID: ${pageId}`);
      return;
    }

    for (const form of forms) {
      console.log(`Processing Form: ${form.name} (ID: ${form.id})`);

      const leads = await fetchLeads(form.id, lastSyncTime);

      console.log(`Fetched Leads for Form ${form.id}:`, JSON.stringify(leads, null, 2)); // Debug leads response

      if (leads.length === 0) {
        console.log(`No leads found for Form: ${form.name} (ID: ${form.id})`);
      } else {
        const metadata = await fetchMetadata(null, null, pageId); // Add ad_id and adgroup_id if needed
        await processLeads(leads, metadata, form.name);
      }
    }

    saveLastSyncTime(now); // Update sync time
  } catch (error) {
    console.error("Error fetching forms and leads:", error.message);
  }
};


// Webhook Verification
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.status(403).send("Verification failed.");
  }
});

// Handle Webhook Events
app.post("/webhook", async (req, res) => {
  const body = req.body;

  console.log("Webhook Payload:", JSON.stringify(body, null, 2));
  if (body.object === "page") {
    for (const entry of body.entry) {
      const pageId = entry.id;
      console.log(`Processing Page ID: ${pageId}`);
      await fetchFormsAndLeads(pageId);
    }
  }

  res.status(200).send("EVENT_RECEIVED");
});

// Start the Server
app.listen(5000, () => {
  console.log("Server is running on port 5000.");
});
