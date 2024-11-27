const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const crypto = require("crypto");

const app = express();
app.use(bodyParser.json());

// Configurations
const VERIFY_TOKEN = "my_verify_token"; // Replace with your webhook verification token
const APP_ID = "497657243241828"; // Your App ID
const APP_SECRET = "6f6668bec23b20a09790e34f2d142f64"; // Your App Secret
const PIXEL_ID = "500781749465576"; // Replace with your Pixel ID
let USER_ACCESS_TOKEN = "EAAHEnds0DWQBO5081rvol3YOETWgDiNZBEEVIJJgoE0Ino5Uz8Nh5qTAvStTZAiBMxBFKf3TZCrsMZAACk5bquQuysjCcpEKnA3rAzRPHWXfxzqusJ5wbN6gDv1upRrJK0ZBgoVkjgjlZBhRZA9K71j6ktVn9LTZBH82TDP5mZCdDJBg2qkiMISX2zl8e"; // Replace with a valid token

// Utility to hash data
const hashValue = (value) => (value ? crypto.createHash("sha256").update(value).digest("hex") : null);

// Refresh User Access Token
const refreshAccessToken = async () => {
  console.log("Refreshing User Access Token...");
  try {
    const response = await axios.get(`https://graph.facebook.com/v17.0/oauth/access_token`, {
      params: {
        grant_type: "client_credentials",
        client_id: APP_ID,
        client_secret: APP_SECRET,
      },
    });

    USER_ACCESS_TOKEN = response.data.access_token;
    console.log("New App Access Token retrieved successfully.");
    return true;
  } catch (error) {
    console.error("Failed to refresh User Access Token:", error.response?.data || error.message);
    return false;
  }
};

// Fetch Page Name
const getPageName = async (pageId) => {
  try {
    const response = await axios.get(`https://graph.facebook.com/v17.0/${pageId}`, {
      params: { access_token: USER_ACCESS_TOKEN, fields: "name" },
    });
    return response.data.name || "Unknown Page";
  } catch (error) {
    console.error("Error fetching page name:", error.response?.data || error.message);
    return "Unknown Page";
  }
};

// Fetch Lead by ID
const fetchLeadById = async (leadId, pageAccessToken) => {
  try {
    const response = await axios.get(`https://graph.facebook.com/v17.0/${leadId}`, {
      params: { access_token: pageAccessToken, fields: "field_data" },
    });

    return response.data || null;
  } catch (error) {
    console.error("Error fetching lead by ID:", error.response?.data || error.message);
    return null;
  }
};

// Process Lead
const processLead = async (leadData, pageName, formName) => {
  try {
    console.log(`Processing lead for Page: ${pageName}, Form: ${formName}`);

    const parsedFields = {};
    leadData.field_data.forEach((field) => {
      parsedFields[field.name] = field.values && field.values.length ? field.values[0] : null;
    });

    console.log("Parsed Lead Data:", JSON.stringify(parsedFields, null, 2));

    // Send data to Pixel
    try {
      const pixelResponse = await axios.post(
        `https://graph.facebook.com/v17.0/${PIXEL_ID}/events`,
        {
          data: [
            {
              event_name: "Lead",
              event_time: Math.floor(Date.now() / 1000),
              user_data: {
                email: hashValue(parsedFields.email),
                phone: hashValue(parsedFields.phone_number),
                fn: parsedFields.full_name ? hashValue(parsedFields.full_name.split(" ")[0]) : null,
                ln: parsedFields.full_name ? hashValue(parsedFields.full_name.split(" ").slice(1).join(" ")) : null,
              },
            },
          ],
        },
        { params: { access_token: USER_ACCESS_TOKEN } }
      );
      console.log("Pixel Response:", JSON.stringify(pixelResponse.data, null, 2));
    } catch (error) {
      console.error("Error sending data to Pixel:", error.response?.data || error.message);
    }
  } catch (error) {
    console.error("Error processing lead:", error.message);
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
      const pageId = entry.id;

      const pageName = entry.name || (await getPageName(pageId));

      if (entry.changes) {
        for (const change of entry.changes) {
          if (change.field === "leadgen") {
            const leadId = change.value.leadgen_id;
            console.log(`New lead generated on Page: ${pageName}, Lead ID: ${leadId}`);

            const leadData = await fetchLeadById(leadId, USER_ACCESS_TOKEN);
            if (leadData) {
              await processLead(leadData, pageName, change.value.form_name || "Unknown Form");
            }
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
