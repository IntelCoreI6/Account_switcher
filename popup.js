// popup.js
console.log("Popup script loaded");

document.addEventListener('DOMContentLoaded', function () {
  const captureButton = document.getElementById('capture-session');
  const profilesListDiv = document.getElementById('profiles-list');
  const messageArea = document.getElementById('message-area'); // Get the message area
  let currentDomain = null;

  // Function to display messages
  function showMessage(message, type = 'success', duration = 3000) {
    messageArea.textContent = message;
    messageArea.className = 'message-' + type; // Applies .message-success, .message-error, etc.
    messageArea.style.display = 'block';

    if (duration) {
      setTimeout(() => {
        messageArea.style.display = 'none';
        messageArea.className = ''; // Clear class
      }, duration);
    }
  }

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
        showMessage(response?.error || "Could not get current domain.", 'error');
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
          const profileNameSpan = document.createElement('span');
          profileNameSpan.textContent = profile.name;
          profileNameSpan.classList.add('profile-name');
          li.appendChild(profileNameSpan);

          const buttonsDiv = document.createElement('div');
          buttonsDiv.classList.add('profile-buttons');

          const switchButton = document.createElement('button');
          switchButton.textContent = 'Switch';
          switchButton.classList.add('switch-profile-button');
          switchButton.addEventListener('click', () => switchProfile(domain, profile.id, profile.name));
          buttonsDiv.appendChild(switchButton);

          const renameButton = document.createElement('button');
          renameButton.textContent = 'Rename';
          renameButton.classList.add('rename-profile-button');
          renameButton.addEventListener('click', () => renameProfile(domain, profile.id, profile.name));
          buttonsDiv.appendChild(renameButton);

          const deleteButton = document.createElement('button');
          deleteButton.textContent = 'Delete';
          deleteButton.classList.add('delete-profile-button');
          deleteButton.addEventListener('click', () => deleteProfile(domain, profile.id, profile.name));
          buttonsDiv.appendChild(deleteButton);
          
          li.appendChild(buttonsDiv);
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
        showMessage("Could not determine the current website's domain.", 'error');
        return;
      }
      const profileName = prompt("Enter a name for this session profile:");
      if (profileName && profileName.trim() !== "") {
        // Disable button to prevent multiple clicks
        captureButton.disabled = true;
        captureButton.textContent = 'Capturing...';

        chrome.runtime.sendMessage({ action: "addProfile", domain: currentDomain, profileName: profileName.trim() }, (response) => {
          captureButton.disabled = false;
          captureButton.textContent = 'Capture Current Session';
          if (response && !response.error) {
            showMessage(`Profile '${response.name}' added successfully!`, 'success');
            if(response.warning) {
                setTimeout(() => showMessage(response.warning, 'warning', 5000), 3100); // Show warning after success
            }
            loadProfilesForDomain(currentDomain); // Refresh list
          } else {
            showMessage(`Error adding profile: ${response?.error || "Unknown error"}`, 'error');
            console.error("Error adding profile:", response);
          }
        });
      }
    });
  }

  // Function to handle profile switching
  function switchProfile(domain, profileId, profileName) {
    showMessage(`Switching to '${profileName}'...`, 'warning', null); // Indefinite until response
    chrome.runtime.sendMessage({ action: "switchActiveProfile", domain: domain, profileId: profileId }, (response) => {
        if (response && response.success) {
            showMessage(response.message || `Switched to profile: '${profileName}'`, 'success', 2500);
            // The tab reload is handled by background.js.
            // Close the popup after a short delay to allow the user to see the message.
            setTimeout(() => window.close(), 2600);
        } else {
            showMessage(`Failed to switch profile: ${response?.error || "Unknown error"}`, 'error', 5000);
        }
    });
  }

  // Function to handle profile renaming
  function renameProfile(domain, profileId, currentName) {
    const newName = prompt("Enter the new name for this profile:", currentName);
    if (newName && newName.trim() !== "" && newName.trim() !== currentName) {
      chrome.runtime.sendMessage({ action: "updateProfileName", domain: domain, profileId: profileId, newName: newName.trim() }, (success) => {
        if (success) {
          showMessage(`Profile renamed to '${newName.trim()}'`, 'success');
          loadProfilesForDomain(domain); // Refresh list
        } else {
          showMessage("Error renaming profile.", 'error');
        }
      });
    }
  }

  // Function to handle profile deletion
  function deleteProfile(domain, profileId, profileName) {
    // Using custom confirm-like experience if we build one, for now, prompt is okay for confirmation
    if (confirm(`Are you sure you want to delete the profile '${profileName}'?`)) {
      chrome.runtime.sendMessage({ action: "deleteProfile", domain: domain, profileId: profileId }, (success) => {
        if (success) {
          showMessage(`Profile '${profileName}' deleted.`, 'success');
          loadProfilesForDomain(domain); // Refresh list
        } else {
          showMessage("Error deleting profile.", 'error');
        }
      });
    }
  }

  // Initial load
  getCurrentDomain();
});