// popup.js
console.log("Popup script loaded");

document.addEventListener('DOMContentLoaded', function () {
  const captureButton = document.getElementById('capture-session');
  const profilesListDiv = document.getElementById('profiles-list');
  let currentDomain = null;

  // Function to get current domain from background script
  function getCurrentDomain() {
    chrome.runtime.sendMessage({ action: "getCurrentDomain" }, (response) => {
      if (response && response.domain) {
        currentDomain = response.domain;
        document.getElementById('current-site').textContent = `Site: ${currentDomain}`;
        loadProfilesForDomain(currentDomain);
      } else {
        document.getElementById('current-site').textContent = "Site: Not available";
        profilesListDiv.innerHTML = '<p>Could not determine current website.</p>';
        console.error("Error getting current domain:", response ? response.error : "No response");
      }
    });
  }

  // Function to load and display profiles for the current domain
  function loadProfilesForDomain(domain) {
    if (!domain) {
      profilesListDiv.innerHTML = '<p>No domain specified.</p>';
      return;
    }
    chrome.runtime.sendMessage({ action: "getProfilesForDomain", domain: domain }, (profiles) => {
      profilesListDiv.innerHTML = ''; // Clear previous list
      if (profiles && profiles.length > 0) {
        const ul = document.createElement('ul');
        profiles.forEach(profile => {
          const li = document.createElement('li');
          li.textContent = profile.name;
          li.dataset.profileId = profile.id;

          // Add a switch button for each profile
          const switchButton = document.createElement('button');
          switchButton.textContent = 'Switch';
          switchButton.classList.add('switch-profile-button');
          switchButton.addEventListener('click', () => switchProfile(domain, profile.id));
          li.appendChild(switchButton);

          // Add a rename button
          const renameButton = document.createElement('button');
          renameButton.textContent = 'Rename';
          renameButton.classList.add('rename-profile-button');
          renameButton.addEventListener('click', () => renameProfile(domain, profile.id, profile.name));
          li.appendChild(renameButton);

          // Add a delete button
          const deleteButton = document.createElement('button');
          deleteButton.textContent = 'Delete';
          deleteButton.classList.add('delete-profile-button');
          deleteButton.addEventListener('click', () => deleteProfile(domain, profile.id));
          li.appendChild(deleteButton);

          ul.appendChild(li);
        });
        profilesListDiv.appendChild(ul);
      } else {
        profilesListDiv.innerHTML = '<p>No profiles saved for this site yet.</p>';
      }
    });
  }

  // Event listener for the capture session button
  if (captureButton) {
    captureButton.addEventListener('click', function() {
      if (!currentDomain) {
        alert("Could not determine the current website's domain.");
        return;
      }
      const profileName = prompt("Enter a name for this session profile:");
      if (profileName && profileName.trim() !== "") {
        chrome.runtime.sendMessage({ action: "addProfile", domain: currentDomain, profileName: profileName.trim() }, (newProfile) => {
          if (newProfile && !newProfile.error) {
            console.log("Profile added:", newProfile);
            loadProfilesForDomain(currentDomain); // Refresh list
          } else {
            alert("Error adding profile: " + (newProfile ? newProfile.error : "Unknown error"));
            console.error("Error adding profile:", newProfile);
          }
        });
      }
    });
  }

  // Function to handle profile switching (Step 4 - basic placeholder)
  function switchProfile(domain, profileId) {
    console.log(`Attempting to switch to profile ${profileId} for domain ${domain}`);
    // Actual cookie swapping logic will be implemented in background.js and called from here
    chrome.runtime.sendMessage({ action: "switchActiveProfile", domain: domain, profileId: profileId }, (response) => {
        if (response && response.success) {
            alert("Switched to profile: " + profileId.substring(0,10)); // Show some feedback
            // Optionally, reload the current tab to reflect the new session
            // chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
            //    if (tabs[0] && tabs[0].id) {
            //        chrome.tabs.reload(tabs[0].id);
            //    }
            // });
            window.close(); // Close popup after switching
        } else {
            alert("Failed to switch profile: " + (response ? response.error : "Unknown error"));
        }
    });
  }

  // Function to handle profile renaming
  function renameProfile(domain, profileId, currentName) {
    const newName = prompt("Enter the new name for this profile:", currentName);
    if (newName && newName.trim() !== "" && newName.trim() !== currentName) {
      chrome.runtime.sendMessage({ action: "updateProfileName", domain: domain, profileId: profileId, newName: newName.trim() }, (success) => {
        if (success) {
          loadProfilesForDomain(domain); // Refresh list
        } else {
          alert("Error renaming profile.");
        }
      });
    }
  }

  // Function to handle profile deletion
  function deleteProfile(domain, profileId) {
    if (confirm("Are you sure you want to delete this profile?")) {
      chrome.runtime.sendMessage({ action: "deleteProfile", domain: domain, profileId: profileId }, (success) => {
        if (success) {
          loadProfilesForDomain(domain); // Refresh list
        } else {
          alert("Error deleting profile.");
        }
      });
    }
  }

  // Initial load
  getCurrentDomain();
});