const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const fs = require("fs");

const app = express();
app.use(bodyParser.json());

const VERIFY_TOKEN = "my_verify_token";
const APP_ID = "497657243241828";
const APP_SECRET = "6f6668bec23b20a09790e34f2d142f64";
let USER_ACCESS_TOKEN = "EAAHEnds0DWQBO5BpFeEmoqDLFK2PZCayVQYwWZBaPzX9zE69EH9IKv78M13qWPVneAdhBGgFSWSfORoOz92fSqrSzZARH5Fa4St6atOeDYZAijpkrxPcfZA05aCZCXTiMpP7rrGQSAtFG8m2RLkJAcSgrZA750BBcpRUOUCODA7R7lLpZAfQuke7kg2IAye7jHa4tjGp12XZC6zROPZCMERJYZD";

let lastFetchedTime = null;

// Load last fetched time
const loadLastFetchedTime = () => {
  if (fs.existsSync("lastFetchedTime.txt")) {
    lastFetchedTime = fs.readFileSync("lastFetchedTime.txt", "utf-8");
    console.log("Last fetched time loaded:", lastFetchedTime);
  } else {
    lastFetchedTime = null;
  }
};

// Save last fetched time
const saveLastFetchedTime = () => {
  fs.writeFileSync("lastFetchedTime.txt", lastFetchedTime);
  console.log("Last fetched time saved:", lastFetchedTime);
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

// Fetch All Pages, Forms, and Leads with Batching
const fetchAllLeads = async () => {
  try {
    console.log("Fetching all pages...");
    const pagesResponse = await axios.get(
      `https://graph.facebook.com/v17.0/me/accounts?fields=id,name,access_token&access_token=${USER_ACCESS_TOKEN}`
    );
    const pages = pagesResponse.data.data;

    for (const page of pages) {
      const pageAccessToken = page.access_token;
      console.log(`Fetching forms for Page: ${page.name} (ID: ${page.id})`);

      const formsResponse = await axios.get(
        `https://graph.facebook.com/v17.0/${page.id}/leadgen_forms?access_token=${pageAccessToken}`
      );
      const forms = formsResponse.data.data;

      // Prepare batch requests
      const batchRequests = forms.map((form) => {
        let relativeUrl = `${form.id}/leads?access_token=${pageAccessToken}`;
        if (lastFetchedTime) {
          relativeUrl += `&filtering=[{"field":"created_time","operator":"GREATER_THAN","value":"${lastFetchedTime}"}]`;
        }
        return {
          method: "GET",
          relative_url: relativeUrl,
        };
      });

      // Break into smaller chunks to avoid API limits
      const batchSize = 10;
      const batches = [];
      for (let i = 0; i < batchRequests.length; i += batchSize) {
        batches.push(batchRequests.slice(i, i + batchSize));
      }

      // Process each batch with delays
      for (const batch of batches) {
        try {
          const batchResponse = await axios.post(
            `https://graph.facebook.com/v17.0/`,
            { batch },
            { params: { access_token: USER_ACCESS_TOKEN } }
          );

          batchResponse.data.forEach((response, index) => {
            if (response.code === 200) {
              const leads = JSON.parse(response.body).data;

              leads.forEach((lead) => {
                console.log(
                  `Lead for Page: ${page.name} (ID: ${page.id})`,
                  JSON.stringify(lead, null, 2)
                );
              });

              if (leads.length > 0) {
                lastFetchedTime = leads[leads.length - 1].created_time;
                saveLastFetchedTime();
              }
            } else {
              console.error(
                `Error in batched response for Form ID: ${batch[index].relative_url}`,
                response.body
              );
            }
          });
        } catch (batchError) {
          console.error("Error executing batch:", batchError.response?.data || batchError.message);
        }
      }
    }
  } catch (error) {
    if (error.response?.data?.error?.code === 190) {
      console.log("Access token expired. Refreshing...");
      await refreshAccessToken();
      return fetchAllLeads(); // Retry after refreshing token
    }
    console.error("Error fetching pages or leads:", error.response?.data || error.message);
  }
};


loadLastFetchedTime();

app.listen(5000, () => {
  console.log("Server running on port 5000.");
  fetchAllLeads();
});
