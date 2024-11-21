const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
app.use(bodyParser.json());

const VERIFY_TOKEN = "my_verify_token";
const APP_ID = "497657243241828";
const APP_SECRET = "6f6668bec23b20a09790e34f2d142f64";
let USER_ACCESS_TOKEN = "EAAHEnds0DWQBO1RCwKw0HSz0VIF5YafrxMXEERPLGk9IaSMcNUnJcTVC25l3FXp8GVhSFUx9qpoQx08CHlRJv4U8f30LhizFK5moyqmA8wDQN2SzvzVKnupI6bAZCatGZAPZAcmSvZCkeDatoWoTKaee2fYQlYjZBuZC8MZCpQSBw88QUKyScP1fIdkxgtZAS03DRMCAnzWwaMUDRwQPZCQZDZD";

const PIXEL_ID = "500781749465576"; // Replace with your Pixel ID
const CAPI_URL = `https://graph.facebook.com/v17.0/${PIXEL_ID}/events`;

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

const hashValue = (value) => {
  return crypto.createHash("sha256").update(value).digest("hex");
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

const parseFieldData = (fieldData) => {
  const parsedData = {};
  fieldData.forEach((field) => {
    parsedData[field.name] = field.values[0] || null; // Safely get field value
  });
  return parsedData;
};

const sendToConversionAPI = async (leadData) => {
  try {
    const payload = {
      data: [
        {
          event_name: "Lead",
          event_time: Math.floor(new Date(leadData.createdTime).getTime() / 1000),
          action_source: "website",
          user_data: Object.entries(leadData).reduce((userData, [key, value]) => {
            if (["email", "phone_number", "first_name", "last_name"].includes(key)) {
              userData[key.substring(0, 2)] = hashValue(value || ""); // Hash email, phone, etc.
            }
            return userData;
          }, {}),
          custom_data: leadData, // Include all dynamically fetched fields
          event_id: leadData.leadId, // Unique event ID
        },
      ],
    };

    const response = await axios.post(CAPI_URL, payload, {
      params: { access_token: USER_ACCESS_TOKEN },
    });
    console.log("Sent to Conversion API:", response.data);
  } catch (error) {
    console.error("Error sending to Conversion API:", error.response?.data || error.message);
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

const getLeadData = async (leadgenId) => {
  try {
    const response = await axios.get(
      `https://graph.facebook.com/v17.0/${leadgenId}?access_token=${USER_ACCESS_TOKEN}`
    );
    const leadData = response.data;
    const parsedFields = parseFieldData(leadData.field_data);

    return {
      leadId: leadData.id,
      formId: leadData.form_id,
      pageId: leadData.page_id,
      pageName: leadData.page_name,
      createdTime: leadData.created_time,
      ...parsedFields, // Include all dynamic fields
    };
  } catch (error) {
    if (error.response?.data?.error?.code === 190) {
      console.log("Token expired. Refreshing token...");
      await refreshAccessToken();
      return getLeadData(leadgenId);
    }
    throw error;
  }
};

loadLastFetchedTime();

app.listen(5000, () => {
  console.log("Server running on port 5000.");
});
