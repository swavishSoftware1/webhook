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
let USER_ACCESS_TOKEN =
  "EAAHEnds0DWQBO4mcEnmEqujrItW7SIoEqqXxHeCetNwW2TeZAb6FOtlZCxZB3NtuHZB8x7GTUHhjmTkuM4oXOnPcobKssMN21GRBIdIsH5ZAZBe72FTnaQ0vh5WEouYi58YZBjUjjqUZAoXtiWxASHXi5ldoIPdA0jOUzX9rKpHiZACcQce2BnZBQzPSxd292R1WO2MrZATMyDO7yVv7ZBZCtxgZDZD"; // Short-lived token

const PIXEL_ID = "your_pixel_id"; // Replace with your Pixel ID
const CAPI_URL = `https://graph.facebook.com/v17.0/${PIXEL_ID}/events`;

let lastFetchedTime = null;

// Load last fetched time
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

// Hash sensitive data for CAPI
const hashValue = (value) => {
  return crypto.createHash("sha256").update(value).digest("hex");
};

// Refresh access token
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

// Parse lead field data
const parseFieldData = (fieldData) => {
  const parsedData = {};
  fieldData.forEach((field) => {
    parsedData[field.name] = field.values[0]; // Get the first value
  });
  return parsedData;
};

// Send data to Facebook Conversion API
const sendToConversionAPI = async (leadData) => {
  try {
    const payload = {
      data: [
        {
          event_name: "Lead",
          event_time: Math.floor(new Date(leadData.createdTime).getTime() / 1000),
          event_source_url: "https://www.example.com", // Replace with your site URL
          action_source: "website",
          user_data: {
            em: hashValue(leadData.email || ""), // Email
            ph: hashValue(leadData.phone_number || ""), // Phone number
            fn: hashValue(leadData.full_name?.split(" ")[0] || ""), // First name
            ln: hashValue(leadData.full_name?.split(" ")[1] || ""), // Last name
          },
          custom_data: {
            form_id: leadData.formId,
            page_id: leadData.pageId,
            page_name: leadData.pageName,
          },
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

// Webhook for verification
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

// Handle webhook events
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
            //await sendToConversionAPI(leadData); // Send to CAPI
          } catch (error) {
            console.error("Error fetching lead data:", error.message);
          }
        }
      }
    }
  }
  res.status(200).send("EVENT_RECEIVED");
});

// Get lead data
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
      ...parsedFields, // Include parsed field data
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

// Fetch all leads
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
          //await sendToConversionAPI(leadData); // Send to CAPI
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
