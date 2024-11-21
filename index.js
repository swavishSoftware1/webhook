const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const crypto = require("crypto");

const app = express();
app.use(bodyParser.json());

// Configurations
const VERIFY_TOKEN = "my_verify_token"; // Replace with your verification token
const APP_ID = "497657243241828"; // Your App ID
const APP_SECRET = "6f6668bec23b20a09790e34f2d142f64"; // Your App Secret
const PIXEL_ID = "500781749465576"; // Your Pixel ID
let USER_ACCESS_TOKEN =
  "EAAHEnds0DWQBO17mDLs91zXLOU79JBQHOD2UOFC9CQUEYzXjjukUjuk2srIljWZBmLwfUZBNK9jBDxAGipqiRSvBtdNtnOwkcymnlCXxZCBR7ljs1cLrNrB27zCYOoZCDZB4y23xQpdizAqqp3USrrxxsy2j1HIGZCANniA8crnVxggGNSF2o22RrTjJdfw0tMzXrkpC2HplXrl4hPuQZDZD"; // Replace with a valid token

// Utility to hash data
const hashValue = (value) => crypto.createHash("sha256").update(value).digest("hex");

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
    console.log("Access token refreshed successfully:", USER_ACCESS_TOKEN);
  } catch (error) {
    console.error("Failed to refresh access token:", error.response?.data || error.message);
    throw new Error("Access token refresh failed.");
  }
};

// Fetch Metadata for Pages, Campaigns, and Ads
const fetchMetadata = async (adId, adGroupId, pageId) => {
  try {
    const adResponse = await axios.get(
      `https://graph.facebook.com/v17.0/${adId}`, {
        params: { access_token: USER_ACCESS_TOKEN, fields: "name" },
      }
    );
    const campaignResponse = await axios.get(
      `https://graph.facebook.com/v17.0/${adGroupId}`, {
        params: { access_token: USER_ACCESS_TOKEN, fields: "name" },
      }
    );
    const pageResponse = await axios.get(
      `https://graph.facebook.com/v17.0/${pageId}`, {
        params: { access_token: USER_ACCESS_TOKEN, fields: "name,category" },
      }
    );

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

// Fetch Lead Data
const getLeadData = async (leadgenId) => {
  try {
    console.log(`Fetching lead data for leadgen ID: ${leadgenId}`);
    const response = await axios.get(
      `https://graph.facebook.com/v17.0/${leadgenId}`, {
        params: { access_token: USER_ACCESS_TOKEN },
      }
    );

    if (!response.data) {
      throw new Error(`Lead data not found for leadgen_id: ${leadgenId}`);
    }

    const leadData = response.data;
    const parsedFields = {};
    leadData.field_data.forEach((field) => {
      parsedFields[field.name] = field.values[0] || null;
    });

    return {
      leadId: leadData.id,
      formId: leadData.form_id,
      pageId: leadData.page_id,
      createdTime: leadData.created_time,
      ...parsedFields,
    };
  } catch (error) {
    if (error.response?.data?.error?.code === 190) {
      console.log("Token expired. Refreshing...");
      await refreshAccessToken();
      return getLeadData(leadgenId);
    } else {
      console.error("Error fetching lead data:", error.response?.data || error.message);
      throw error;
    }
  }
};

// Webhook Verification
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

  console.log("Webhook Payload:", JSON.stringify(body, null, 2)); // Log full payload

  if (body.object === "page") {
    for (const entry of body.entry) {
      for (const change of entry.changes) {
        if (change.field === "leadgen") {
          const { leadgen_id: leadgenId, ad_id: adId, adgroup_id: adGroupId, page_id: pageId, form_id: formId } =
            change.value;
          try {
            const leadData = await getLeadData(leadgenId);
            const metadata = await fetchMetadata(adId, adGroupId, pageId);

            console.log("Fetched Lead Data:", JSON.stringify(leadData, null, 2));
            console.log("Metadata:", metadata);

            console.log(`
              Page Name: ${metadata.pageName}
              Page Category: ${metadata.pageCategory}
              Campaign Name: ${metadata.campaignName}
              Ad Name: ${metadata.adName}
              Form ID: ${formId}
              Lead ID: ${leadgenId}
            `);

            await sendToConversionsAPI({
              ...leadData,
              pageName: metadata.pageName,
              campaignName: metadata.campaignName,
              adName: metadata.adName,
            });
          } catch (error) {
            console.error("Error processing lead data:", error.message);
          }
        }
      }
    }
  }

  res.status(200).send("EVENT_RECEIVED");
});

// Start the Server
app.listen(5000, () => {
  console.log("Server is running on port 5000.");
});
