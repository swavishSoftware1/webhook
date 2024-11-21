const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
app.use(bodyParser.json());

// Configurations
const VERIFY_TOKEN = "my_verify_token"; // Replace with your verification token
const APP_ID = "497657243241828"; // Your App ID
const APP_SECRET = "6f6668bec23b20a09790e34f2d142f64"; // Your App Secret
const PIXEL_IDS = ["500781749465576"]; // Your Pixel IDs (can handle multiple IDs)
let USER_ACCESS_TOKEN =
  "EAAHEnds0DWQBO17mDLs91zXLOU79JBQHOD2UOFC9CQUEYzXjjukUjuk2srIljWZBmLwfUZBNK9jBDxAGipqiRSvBtdNtnOwkcymnlCXxZCBR7ljs1cLrNrB27zCYOoZCDZB4y23xQpdizAqqp3USrrxxsy2j1HIGZCANniA8crnVxggGNSF2o22RrTjJdfw0tMzXrkpC2HplXrl4hPuQZDZD"; // Replace with your current token

// Utility functions
const loadLastFetchedTime = () => {
  if (fs.existsSync("lastFetchedTime.txt")) {
    return fs.readFileSync("lastFetchedTime.txt", "utf-8");
  }
  return null;
};

const saveLastFetchedTime = (time) => {
  fs.writeFileSync("lastFetchedTime.txt", time);
};

const hashValue = (value) => {
  return crypto.createHash("sha256").update(value).digest("hex");
};

// Refresh Access Token
const refreshAccessToken = async () => {
  try {
    console.log("Refreshing access token...");
    const response = await axios.get(
      `https://graph.facebook.com/v17.0/oauth/access_token`, {
        params: {
          grant_type: "fb_exchange_token",
          client_id: APP_ID,
          client_secret: APP_SECRET,
          fb_exchange_token: USER_ACCESS_TOKEN,
        },
      }
    );
    USER_ACCESS_TOKEN = response.data.access_token;
    console.log("Access token refreshed:", USER_ACCESS_TOKEN);
  } catch (error) {
    console.error("Failed to refresh access token:", error.response?.data || error.message);
    throw new Error("Access token refresh failed.");
  }
};

// Parse Lead Field Data
const parseFieldData = (fieldData) => {
  const parsedData = {};
  fieldData.forEach((field) => {
    parsedData[field.name] = field.values[0] || null;
  });
  return parsedData;
};

// Send Data to Facebook Conversion API
const sendToConversionAPI = async (leadData) => {
  for (const pixelId of PIXEL_IDS) {
    try {
      const payload = {
        data: [
          {
            event_name: "Lead",
            event_time: Math.floor(new Date(leadData.createdTime).getTime() / 1000),
            action_source: "website",
            user_data: {
              em: hashValue(leadData.email || ""),
              ph: hashValue(leadData.phone_number || ""),
              fn: hashValue(leadData.full_name?.split(" ")[0] || ""),
              ln: hashValue(leadData.full_name?.split(" ")[1] || ""),
            },
            custom_data: {
              form_id: leadData.formId,
              page_id: leadData.pageId,
              page_name: leadData.pageName,
              location: leadData.location || "",
              utm_source: leadData.utm_source || "",
              product_interest: leadData.product_interest || "",
            },
            event_id: `${pixelId}-${leadData.leadId}`,
          },
        ],
      };

      const response = await axios.post(
        `https://graph.facebook.com/v17.0/${pixelId}/events`,
        payload,
        { params: { access_token: USER_ACCESS_TOKEN } }
      );
      console.log(`Sent to Pixel ID ${pixelId}:`, response.data);
    } catch (error) {
      console.error(
        `Error sending to Pixel ID ${pixelId}:`,
        error.response?.data || error.message
      );
    }
  }
};

// Fetch Lead Data from Facebook API
const getLeadData = async (leadgenId) => {
  try {
    const response = await axios.get(
      `https://graph.facebook.com/v17.0/${leadgenId}`, {
        params: { access_token: USER_ACCESS_TOKEN },
      }
    );

    if (!response.data) {
      throw new Error(`Lead data not found for leadgen_id: ${leadgenId}`);
    }

    const leadData = response.data;
    const parsedFields = parseFieldData(leadData.field_data);

    return {
      leadId: leadData.id,
      formId: leadData.form_id,
      pageId: leadData.page_id,
      pageName: leadData.page_name,
      createdTime: leadData.created_time,
      ...parsedFields,
    };
  } catch (error) {
    if (error.response?.data?.error?.code === 190) {
      console.log("Token expired. Refreshing token...");
      await refreshAccessToken();
      return getLeadData(leadgenId);
    } else if (error.response?.status === 400) {
      console.error(`Error fetching lead data for leadgen_id: ${leadgenId}`, error.response.data);
    } else {
      console.error("Unexpected error fetching lead data:", error.response?.data || error.message);
    }
    throw error;
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

  console.log("Webhook Payload:", JSON.stringify(body, null, 2)); // Log full payload

  if (body.object === "page") {
    for (const entry of body.entry) {
      for (const change of entry.changes) {
        if (change.field === "leadgen") {
          const leadgenId = change.value.leadgen_id;
          try {
            const leadData = await getLeadData(leadgenId);
            console.log("Lead Data:", JSON.stringify(leadData, null, 2));
            await sendToConversionAPI(leadData);
          } catch (error) {
            console.error("Error fetching lead data:", error.message);
          }
        }
      }
    }
  }
  res.status(200).send("EVENT_RECEIVED");
});

// Start the Server
app.listen(5000, () => {
  console.log("Server running on port 5000.");
});
