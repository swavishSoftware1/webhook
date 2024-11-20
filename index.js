const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const fs = require("fs");

const app = express();
app.use(bodyParser.json());

const VERIFY_TOKEN = "my_verify_token";
const APP_ID = "497657243241828";
const APP_SECRET = "6f6668bec23b20a09790e34f2d142f64";
let USER_ACCESS_TOKEN = "EAAHEnds0DWQBO0uzyeR2HxOeZByf3ZAcy4n27szvVQbP8XnJ3xyPd9aBRrvzGxZCeYL6S6qwIUFZBv1xRQV15GCtAWtvuViJ9OxUHtjmAab2oDz867rwzCM3L3hZCFKf2mZCKfiWoAK73BUlgb7igXHz5wCNy0ZB9e77e9moa5czHNZBMIwIA7LhN6QvQKwTy6eOwtwV6He6QZAKZCfSyGXgZDZD";

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
      `https://graph.facebook.com/v17.0/oauth/access_token`,
      {
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
    console.error(
      "Failed to refresh access token:",
      error.response?.data || error.message
    );
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
      let pageAccessToken = page.access_token;

      // If the page access token is missing or invalid, regenerate it dynamically
      if (!pageAccessToken) {
        console.log(`Generating access token for Page: ${page.name} (ID: ${page.id})`);
        const tokenResponse = await axios.get(
          `https://graph.facebook.com/v17.0/${page.id}?fields=access_token&access_token=${USER_ACCESS_TOKEN}`
        );
        pageAccessToken = tokenResponse.data.access_token;
      }

      console.log(`Fetching forms for Page: ${page.name} (ID: ${page.id})`);

      try {
        const formsResponse = await axios.get(
          `https://graph.facebook.com/v17.0/${page.id}/leadgen_forms?access_token=${pageAccessToken}`
        );
        const forms = formsResponse.data.data;

        const batchRequests = forms.map((form) => {
          let relativeUrl = `${form.id}/leads?access_token=${pageAccessToken}`;
          if (lastFetchedTime) {
            relativeUrl += `&filtering=[{"field":"created_time","operator":"GREATER_THAN","value":"${lastFetchedTime}"}]`;
          }
          return { method: "GET", relative_url: relativeUrl };
        });

        const batchSize = 10; // Limit the batch size
        for (let i = 0; i < batchRequests.length; i += batchSize) {
          const batch = batchRequests.slice(i, i + batchSize);

          let retryCount = 0;
          const maxRetries = 3;

          while (retryCount <= maxRetries) {
            try {
              const batchResponse = await axios.post(
                `https://graph.facebook.com/v17.0/`,
                { batch },
                { params: { access_token: USER_ACCESS_TOKEN } }
              );

              batchResponse.data.forEach((response, index) => {
                if (response.code === 200) {
                  const leads = JSON.parse(response.body).data;

                  if (leads.length > 0) {
                    leads.forEach((lead) => {
                      console.log(
                        `Lead for Page: ${page.name} (ID: ${page.id}):`,
                        JSON.stringify(lead, null, 2)
                      );
                    });

                    lastFetchedTime = leads[leads.length - 1].created_time;
                    saveLastFetchedTime();
                  } else {
                    console.log(`No new leads for Form ID: ${batch[index].relative_url}`);
                  }
                } else {
                  console.error(
                    `Error in batched response for Form ID: ${batch[index].relative_url}`,
                    response.body
                  );
                }
              });

              // Break the retry loop if successful
              break;
            } catch (error) {
              console.error(
                `Error in batch for Page: ${page.name} (ID: ${page.id}), Retry: ${retryCount + 1}`,
                error.response?.data || error.message
              );

              retryCount++;
              if (retryCount > maxRetries) {
                console.error("Max retries reached. Skipping this batch.");
                break;
              }

              // Exponential backoff
              await new Promise((resolve) => setTimeout(resolve, 2000 * retryCount));
            }
          }
        }
      } catch (formError) {
        console.error(
          `Error fetching forms for Page: ${page.name} (ID: ${page.id}):`,
          formError.response?.data || formError.message
        );
      }
    }
  } catch (pageError) {
    if (pageError.response?.data?.error?.code === 190) {
      console.log("Access token expired. Refreshing...");
      await refreshAccessToken();
      return fetchAllLeads(); // Retry after refreshing token
    }
    console.error("Error fetching pages:", pageError.response?.data || pageError.message);
  }
};

// Load last fetched time
loadLastFetchedTime();

// Start the server and fetch leads
app.listen(5000, () => {
  console.log("Server running on port 5000.");
  fetchAllLeads();
});
