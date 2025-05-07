// background.js
console.log("Background service worker started.");

chrome.runtime.onInstalled.addListener(() => {
  console.log("Session Switcher extension installed.");
  // Initialize storage if it hasn't been already
  chrome.storage.local.get("profiles", (data) => {
    if (!data.profiles) {
      chrome.storage.local.set({ profiles: {} });
    }
  });
});

// Helper function to extract hostname from a URL
function getDomainFromUrl(url) {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch (e) {
    console.error("Invalid URL:", url, e);
    return null;
  }
}

// --- Profile Management Functions ---

// Get all profiles
async function getAllProfiles() {
  const result = await chrome.storage.local.get("profiles");
  return result.profiles || {};
}

// Get profiles for a specific domain
async function getProfilesForDomain(domain) {
  if (!domain) return [];
  const profiles = await getAllProfiles();
  return profiles[domain] || [];
}

// Add a new profile
async function addProfile(domain, profileName, cookiesToStore) {
  if (!domain || !profileName) return null;

  const profiles = await getAllProfiles();
  if (!profiles[domain]) {
    profiles[domain] = [];
  }

  const newProfile = {
    id: `profile_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    name: profileName,
    cookies: cookiesToStore, // Cookies will be captured later
    createdAt: new Date().toISOString(),
    // icon: null, // Future feature
    // color: null, // Future feature
  };

  profiles[domain].push(newProfile);
  await chrome.storage.local.set({ profiles });
  console.log(`Profile '${profileName}' added for domain ${domain}`);
  return newProfile;
}

// Update a profile (e.g., rename)
async function updateProfileName(domain, profileId, newName) {
  if (!domain || !profileId || !newName) return false;

  const profiles = await getAllProfiles();
  if (!profiles[domain]) return false;

  const profileIndex = profiles[domain].findIndex(p => p.id === profileId);
  if (profileIndex === -1) return false;

  profiles[domain][profileIndex].name = newName;
  await chrome.storage.local.set({ profiles });
  console.log(`Profile ${profileId} in domain ${domain} renamed to '${newName}'`);
  return true;
}

// Delete a profile
async function deleteProfile(domain, profileId) {
  if (!domain || !profileId) return false;

  const profiles = await getAllProfiles();
  if (!profiles[domain]) return false;

  const initialLength = profiles[domain].length;
  profiles[domain] = profiles[domain].filter(p => p.id !== profileId);

  if (profiles[domain].length === initialLength) return false; // Profile not found

  if (profiles[domain].length === 0) {
    delete profiles[domain]; // Clean up domain if no profiles left
  }

  await chrome.storage.local.set({ profiles });
  console.log(`Profile ${profileId} deleted from domain ${domain}`);
  return true;
}

// Listener for messages from popup or content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getProfilesForDomain") {
    getProfilesForDomain(request.domain).then(sendResponse);
    return true; // Indicates that the response is sent asynchronously
  } else if (request.action === "addProfile") {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (tabs[0] && tabs[0].url) {
        const currentDomain = getDomainFromUrl(tabs[0].url);
        // Ensure the request domain matches the current tab's domain for security/consistency.
        // The popup should ideally always send the domain derived from the active tab.
        if (currentDomain && request.domain && currentDomain.includes(request.domain)) {
          const capturedCookies = await captureCookiesForDomain(currentDomain);
          if (capturedCookies && capturedCookies.length > 0) {
            addProfile(request.domain, request.profileName, capturedCookies).then(sendResponse);
          } else {
            // It's possible a site uses HttpOnly cookies set by subdomains, or complex storage.
            // For now, a simple check.
            console.warn(`No cookies captured for domain ${currentDomain}. This might be okay if session is managed differently, or if cookies are very strictly scoped.`);
            // Proceed with adding the profile, but with an empty cookie set initially, or decide on a different UX.
            // For this iteration, we'll allow creating a profile even if no cookies are immediately captured, 
            // as some complex sites might require more nuanced capture (e.g. after specific interactions).
            // However, the primary use case relies on cookies.
            addProfile(request.domain, request.profileName, []).then(profile => {
              if (profile) {
                sendResponse({ ...profile, warning: "No cookies were captured for this domain. The session might not be saved correctly." });
              } else {
                sendResponse({ error: "Failed to create profile even without cookies." });
              }
            });
          }
        } else {
          sendResponse({ error: `Domain mismatch. Tab domain: ${currentDomain}, Requested domain: ${request.domain}` });
        }
      } else {
        sendResponse({ error: "Unable to get current tab information to capture cookies." });
      }
    });
    return true;
  } else if (request.action === "updateProfileName") {
    updateProfileName(request.domain, request.profileId, request.newName).then(sendResponse);
    return true;
  } else if (request.action === "deleteProfile") {
    deleteProfile(request.domain, request.profileId).then(sendResponse);
    return true;
  } else if (request.action === "getCurrentDomain") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].url) {
        sendResponse({ domain: getDomainFromUrl(tabs[0].url) });
      } else {
        sendResponse({ domain: null, error: "Could not get current tab URL." });
      }
    });
    return true;
  } else if (request.action === "switchActiveProfile") {
    handleSwitchActiveProfile(request.domain, request.profileId, sender.tab, sendResponse);
    return true; // Indicates that the response is sent asynchronously
  }
  // Add other actions as needed
  return false; // No async response
});

async function clearCookiesForDomain(domain, storeId) {
  if (!domain) return 0;
  let cookiesCleared = 0;
  try {
    const cookies = await chrome.cookies.getAll({ domain: domain });
    if (cookies.length === 0) {
      console.log(`No cookies to clear for domain: ${domain}`);
      return 0;
    }
    for (const cookie of cookies) {
      // Construct the URL required by chrome.cookies.remove
      // Ensure domain does not start with a dot for URL construction if it was a host cookie.
      const cookieDomain = cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain;
      const url = `http${cookie.secure ? 's' : ''}://${cookieDomain}${cookie.path}`;
      await chrome.cookies.remove({ url: url, name: cookie.name, storeId: cookie.storeId });
      cookiesCleared++;
    }
    console.log(`Cleared ${cookiesCleared} cookies for domain: ${domain}`);
    return cookiesCleared;
  } catch (error) {
    console.error(`Error clearing cookies for ${domain}:`, error);
    return 0;
  }
}

async function handleSwitchActiveProfile(domain, profileId, activeTab, sendResponse) {
  if (!domain || !profileId) {
    sendResponse({ success: false, error: "Domain or Profile ID missing." });
    return;
  }

  try {
    // 1. Get the target profile first to ensure it exists
    const profiles = await getAllProfiles();
    const domainProfiles = profiles[domain] || [];
    const targetProfile = domainProfiles.find(p => p.id === profileId);

    if (!targetProfile || !targetProfile.cookies) {
      sendResponse({ success: false, error: "Profile not found or no cookies in profile." });
      // Optionally, still try to reload the tab if cookies were meant to be cleared for a "logged out" state
      // For now, we just error out.
      return;
    }
    
    // 2. Clear current cookies for the domain from the active tab's cookie store
    // We need the storeId from the active tab to ensure we are clearing/setting cookies in the correct context (e.g., container tabs)
    const tabStoreId = activeTab && activeTab.cookieStoreId ? activeTab.cookieStoreId : null;
    // Fallback to clearing for the domain generally if no specific storeId, though this is less precise.
    // For most common cases, chrome.cookies.getAll({domain}) works across stores, but removal/setting needs storeId for precision.
    // However, chrome.cookies.getAll does not accept storeId. We get all and then filter if needed, or rely on domain matching.
    // The most robust way is to clear cookies from the specific storeId if available.
    
    // Get all cookies for the domain first
    const currentCookies = await chrome.cookies.getAll({ domain });

    // Filter them by the tab's cookie store ID if available
    for (const cookie of currentCookies) {
        if (tabStoreId && cookie.storeId !== tabStoreId) {
            // If we have a specific tabStoreId, only remove cookies from that store.
            // This prevents clearing cookies from other container contexts if not intended.
            // However, if the goal is to switch the session for *this* domain regardless of container,
            // then clearing without storeId (or iterating all stores) might be desired.
            // For now, let's be conservative: if tabStoreId is known, use it.
            // This part is tricky: chrome.cookies.remove needs a storeId. If not provided, it uses the current execution context's storeId.
            // For a background script, this might not be what we want if we are targeting a specific tab's session.
            // The `sender.tab.cookieStoreId` is the right way to go.
            continue; 
        }
        const cookieDomain = cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain;
        const url = `http${cookie.secure ? 's' : ''}://${cookieDomain}${cookie.path}`;
        try {
            await chrome.cookies.remove({ url: url, name: cookie.name, storeId: cookie.storeId }); // Use cookie's own storeId for removal
        } catch (e) {
            console.warn("Failed to remove cookie:", cookie.name, e);
        }
    }
    console.log(`Cleared existing cookies for domain: ${domain} (considering tab context if available)`);

    // 3. Apply the new cookies from the profile
    // Ensure these cookies are set with the correct storeId if provided by the original cookie data
    await applyCookiesForProfile(targetProfile.cookies, tabStoreId); // Pass tabStoreId to applyCookies
    console.log(`Successfully applied cookies for profile: ${targetProfile.name}`);

    // 4. Reload the active tab to reflect the new session
    if (activeTab && activeTab.id) {
      chrome.tabs.reload(activeTab.id, { bypassCache: true }, () => {
        if (chrome.runtime.lastError) {
          console.warn("Error reloading tab:", chrome.runtime.lastError.message);
          sendResponse({ success: true, reloaded: false, message: `Cookies swapped for ${targetProfile.name}, but tab reload failed: ${chrome.runtime.lastError.message}` });
        } else {
          console.log("Tab reloaded successfully after profile switch.");
          sendResponse({ success: true, reloaded: true, message: `Switched to profile: ${targetProfile.name}` });
        }
      });
    } else {
      sendResponse({ success: true, reloaded: false, message: `Cookies swapped for ${targetProfile.name}, but no active tab found to reload.` });
    }

  } catch (error) {
    console.error("Error switching profile:", error);
    sendResponse({ success: false, error: error.message });
    // Attempt to reload if an error occurred mid-way, as state might be inconsistent.
    if (activeTab && activeTab.id) {
        chrome.tabs.reload(activeTab.id);
      }
  }
}

// Example of how to get cookies (will be used in Step 3)
async function captureCookiesForDomain(domain) {
  if (!domain) return [];
  try {
    // Get all cookies that match the domain.
    // This includes cookies for subdomains of the given domain.
    // e.g., if domain is "google.com", it gets cookies for "mail.google.com" too.
    const cookies = await chrome.cookies.getAll({ domain: domain });

    // It might also be relevant to get cookies for the exact hostname if strict scoping is needed
    // const hostCookies = await chrome.cookies.getAll({ domain: new URL(`http://${domain}`).hostname });
    // const allRelevantCookies = [...cookies, ...hostCookies];
    // const uniqueCookies = Array.from(new Map(allRelevantCookies.map(c => [c.name + c.domain + c.path, c])).values());

    console.log(`Captured ${cookies.length} cookies for domain ${domain}:`, cookies);

    if (cookies.length === 0) {
        console.warn(`No cookies found for domain: ${domain}. Ensure you are logged in or the site uses cookies for session management.`);
    }

    return cookies.map(cookie => ({
        // Construct the URL needed for chrome.cookies.set
        // It must be a URL associated with the cookie.
        // Typically, this is http(s):// + domain + path
        url: `http${cookie.secure ? 's' : ''}://${cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain}${cookie.path}`,
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        expirationDate: cookie.expirationDate,
        storeId: cookie.storeId
        // sameSite status is not directly settable via chrome.cookies.set for security reasons,
        // but it is preserved when cookies are managed by the browser.
    }));
  } catch (error) {
    console.error(`Error capturing cookies for ${domain}:`, error);
    return [];
  }
}

// Example of how to set cookies (will be used in Step 4)
async function applyCookiesForProfile(cookies, targetStoreId) {
    if (!cookies || cookies.length === 0) return;

    for (const cookie of cookies) {
        const cookieDetails = {
            url: cookie.url, 
            name: cookie.name,
            value: cookie.value,
            domain: cookie.domain,
            path: cookie.path,
            secure: cookie.secure,
            httpOnly: cookie.httpOnly,
            // Use the storeId from the original cookie, but override if a specific targetStoreId is given (e.g., from the active tab)
            // This is important for container tabs or specific contexts.
            storeId: targetStoreId || cookie.storeId 
        };
        
        if (cookie.expirationDate) {
            cookieDetails.expirationDate = cookie.expirationDate;
        }

        try {
            // Check if domain starts with a dot, and if so, remove it for the set call if it causes issues.
            // Generally, chrome.cookies.set handles this, but being explicit can avoid problems.
            // if (cookieDetails.domain && cookieDetails.domain.startsWith('.')) {
            //   cookieDetails.domain = cookieDetails.domain.substring(1);
            // }
            await chrome.cookies.set(cookieDetails);
        } catch (error) {
            console.error("Error setting cookie:", cookie.name, cookieDetails, error);
        }
    }
    console.log(`Attempted to apply ${cookies.length} cookies.`);
}