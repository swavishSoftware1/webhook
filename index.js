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
let USER_ACCESS_TOKEN = "EAAHEnds0DWQBO5081rvol3YOETWgDiNZBEEVIJJgoE0Ino5Uz8Nh5qTAvStTZAiBMxBFKf3TZCrsMZAACk5bquQuysjCcpEKnA3rAzRPHWXfxzqusJ5wbN6gDv1upRrJK0ZBgoVkjgjlZBhRZA9K71j6ktVn9LTZBH82TDP5mZCdDJBg2qkiMISX2zl8e"; // Replace with a valid token
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

// Refresh or regenerate User Access Token
const refreshAccessToken = async () => {
  try {
    console.log("Refreshing User Access Token...");
    const response = await axios.get(`https://graph.facebook.com/v17.0/oauth/access_token`, {
      params: {
        grant_type: "fb_exchange_token",
        client_id: APP_ID,
        client_secret: APP_SECRET,
        fb_exchange_token: USER_ACCESS_TOKEN,
      },
    });
    USER_ACCESS_TOKEN = response.data.access_token;
    console.log("User Access Token refreshed successfully.");
  } catch (error) {
    console.error("Failed to refresh User Access Token. Generating new app-level token...");
    await generateAppAccessToken();
  }
};

// Generate a new App-Level Access Token
const generateAppAccessToken = async () => {
  try {
    console.log("Generating new App Access Token...");
    const response = await axios.get(`https://graph.facebook.com/v17.0/oauth/access_token`, {
      params: {
        client_id: APP_ID,
        client_secret: APP_SECRET,
        grant_type: "client_credentials",
      },
    });
    USER_ACCESS_TOKEN = response.data.access_token;
    console.log("App Access Token generated successfully.");
  } catch (error) {
    console.error("Failed to generate App Access Token:", error.response?.data || error.message);
    throw new Error("App Access Token generation failed.");
  }
};

// Fetch Page Access Token
const getPageAccessToken = async (pageId) => {
  try {
    console.log(`Fetching Page Access Token for Page ID: ${pageId}`);
    const response = await axios.get(`https://graph.facebook.com/v17.0/me/accounts`, {
      params: { access_token: USER_ACCESS_TOKEN, fields: "id,name,access_token" },
    });

    const pages = response.data.data;
    const page = pages.find((p) => p.id === pageId);

    if (!page) {
      throw new Error(`No access to page with ID: ${pageId}`);
    }

    return page.access_token;
  } catch (error) {
    console.error("Error fetching Page Access Token:", error.response?.data || error.message);
    throw error;
  }
};

// Fetch all leads for a form, optionally filtered by last sync time
const fetchLeads = async (formId, pageAccessToken, since = null) => {
  try {
    const params = { access_token: pageAccessToken };

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

// Send Data to Facebook Pixel
const sendDataToPixel = async (eventData) => {
  try {
    const response = await axios.post(
      `https://graph.facebook.com/v17.0/${PIXEL_ID}/events`,
      {
        data: [
          {
            event_name: "Lead",
            event_time: Math.floor(Date.now() / 1000),
            user_data: eventData,
          },
        ],
      },
      { params: { access_token: USER_ACCESS_TOKEN } }
    );

    console.log("Data sent to Pixel:", response.data);
  } catch (error) {
    console.error("Error sending data to Pixel:", error.response?.data || error.message);
  }
};

// Process Leads
const processLeads = async (leads, pageName, formName) => {
  for (const lead of leads) {
    try {
      console.log(`Processing lead for Page: ${pageName}, Form: ${formName}`);
      const parsedFields = {};
      lead.field_data.forEach((field) => {
        parsedFields[field.name] = field.values && field.values.length ? field.values[0] : null;
      });

      const eventData = {
        email: parsedFields.email ? hashValue(parsedFields.email) : null,
        phone: parsedFields.phone_number ? hashValue(parsedFields.phone_number) : null,
        fn: parsedFields.full_name ? hashValue(parsedFields.full_name.split(" ")[0]) : null,
        ln: parsedFields.full_name ? hashValue(parsedFields.full_name.split(" ").slice(1).join(" ")) : null,
      };

      await sendDataToPixel(eventData);
    } catch (error) {
      console.error("Error processing lead:", error.message);
    }
  }
};

// Fetch forms and their leads for a page
const fetchFormsAndLeads = async (pageId, pageName, isHistorical = false) => {
  try {
    const pageAccessToken = await getPageAccessToken(pageId);

    const response = await axios.get(`https://graph.facebook.com/v17.0/${pageId}/leadgen_forms`, {
      params: { access_token: pageAccessToken, fields: "id,name" },
    });

    const forms = response.data.data || [];
    const lastSyncTime = isHistorical ? null : getLastSyncTime();

    for (const form of forms) {
      const leads = await fetchLeads(form.id, pageAccessToken, lastSyncTime);
      await processLeads(leads, pageName, form.name);
    }
  } catch (error) {
    console.error("Error fetching forms and leads:", error.message);
  }
};

// Fetch historical leads on server startup
const fetchHistoricalLeads = async () => {
  try {
    const response = await axios.get(`https://graph.facebook.com/v17.0/me/accounts`, {
      params: { access_token: USER_ACCESS_TOKEN, fields: "id,name" },
    });

    const pages = response.data.data || [];
    for (const page of pages) {
      await fetchFormsAndLeads(page.id, page.name, true);
    }

    saveLastSyncTime(Math.floor(Date.now() / 1000));
  } catch (error) {
    console.error("Error fetching historical leads:", error.message);
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

  if (body.object === "page") {
    for (const entry of body.entry) {
      await fetchFormsAndLeads(entry.id, entry.name || "Unknown Page");
    }
  }

  res.status(200).send("EVENT_RECEIVED");
});

// Start the Server
app.listen(5000, async () => {
  console.log("Server is running on port 5000.");
  await fetchHistoricalLeads();
});
