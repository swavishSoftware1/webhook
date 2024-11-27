const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const crypto = require("crypto");

const app = express();
app.use(bodyParser.json());

// Configurations
const VERIFY_TOKEN = "my_verify_token"; // Replace with your webhook verification token
const APP_ID = "497657243241828"; // Your App ID
const APP_SECRET = "6f666b8ec23b20a09790e34f2d142f64"; // Your App Secret
let USER_ACCESS_TOKEN = "EAAHEnds0DWQBO5081rvol3YOETWgDiNZBEEVIJJgoE0Ino5Uz8Nh5qTAvStTZAiBMxBFKf3TZCrsMZAACk5bquQuysjCcpEKnA3rAzRPHWXfxzqusJ5wbN6gDv1upRrJK0ZBgoVkjgjlZBhRZA9K71j6ktVn9LTZBH82TDP5mZCdDJBg2qkiMISX2zl8e"; // Replace with a valid token

// Refresh User Access Token
const refreshAccessToken = async () => {
  try {
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
    console.error("Failed to refresh User Access Token:", error.response?.data || error.message);
  }
};

// Fetch Page Name
const fetchPageName = async (pageId) => {
  try {
    const response = await axios.get(`https://graph.facebook.com/v17.0/${pageId}`, {
      params: { access_token: USER_ACCESS_TOKEN, fields: "name" },
    });
    return response.data.name;
  } catch (error) {
    console.error("Error fetching page name:", error.response?.data || error.message);
    return "Unknown Page";
  }
};

// Fetch Specific Lead
const fetchSpecificLead = async (leadgenId, pageAccessToken) => {
  try {
    const response = await axios.get(`https://graph.facebook.com/v17.0/${leadgenId}`, {
      params: { access_token: pageAccessToken, fields: "field_data,created_time" },
    });
    return response.data;
  } catch (error) {
    console.error("Error fetching specific lead:", error.response?.data || error.message);
    return null;
  }
};

// Process Dynamic Lead Data
const processLead = async (lead, pageName, formName) => {
  try {
    console.log(`Processing lead for Page: ${pageName}, Form: ${formName}`);

    // Dynamically process fields
    const dynamicFields = {};
    lead.field_data.forEach((field) => {
      dynamicFields[field.name] = field.values && field.values.length ? field.values[0] : null;
    });

    console.log("Parsed Dynamic Lead Data:", JSON.stringify(dynamicFields, null, 2));

    // Example: Send to CRM or log for further processing
    console.log("Processed Dynamic Fields:", dynamicFields);
  } catch (error) {
    console.error("Error processing lead:", error.message);
  }
};

// Fetch Page Access Token
const getPageAccessToken = async (pageId) => {
  try {
    const response = await axios.get(`https://graph.facebook.com/v17.0/me/accounts`, {
      params: { access_token: USER_ACCESS_TOKEN, fields: "id,name,access_token" },
    });

    const pages = response.data.data || [];
    const page = pages.find((p) => p.id === pageId);

    if (!page) {
      console.error(`No access to page with ID: ${pageId}`);
      return null;
    }

    return page.access_token;
  } catch (error) {
    console.error("Error fetching Page Access Token:", error.response?.data || error.message);
    return null;
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
      const pageName = await fetchPageName(pageId);

      if (entry.changes) {
        for (const change of entry.changes) {
          if (change.field === "leadgen") {
            console.log(`New lead generated on Page: ${pageName}`);

            const leadgenId = change.value.leadgen_id;
            const pageAccessToken = await getPageAccessToken(pageId);

            if (!pageAccessToken) {
              console.error(`Failed to retrieve access token for Page ID: ${pageId}`);
              continue;
            }

            const lead = await fetchSpecificLead(leadgenId, pageAccessToken);
            if (lead) {
              await processLead(lead, pageName, `Form ID: ${change.value.form_id}`);
            }
          }
        }
      }
    }
  }

  res.status(200).send("EVENT_RECEIVED");
});

// Start the Server
app.listen(5000, async () => {
  console.log("Server is running on port 5000.");
  await refreshAccessToken(); // Automatically refresh the token at startup
});
