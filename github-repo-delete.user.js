// ==UserScript==
// @name         GitHub Repo Delete Button
// @namespace    https://github.com/mattburkester
// @version      1.0.0
// @description  Adds a delete repository button below the Contributors section on GitHub repo pages
// @author       mattburkester
// @match        https://github.com/*/*
// @exclude      https://github.com/*/*/**
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ─── Configuration ──────────────────────────────────────────────────────────
  // Store your GitHub Personal Access Token (needs `delete_repo` scope).
  // On first run you will be prompted to enter it; it is saved for future use.
  const TOKEN_KEY = 'gh_delete_token';

  function getToken() {
    const stored = GM_getValue(TOKEN_KEY, '');
    if (stored) return stored;
    const entered = prompt(
      'GitHub Repo Delete Button\n\n' +
      'Enter a GitHub Personal Access Token with the "delete_repo" scope.\n' +
      'This is stored locally on your device and never sent anywhere except api.github.com.'
    );
    if (entered && entered.trim()) {
      GM_setValue(TOKEN_KEY, entered.trim());
      return entered.trim();
    }
    return null;
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────
  function getRepoInfo() {
    // pathname: /owner/repo  (already excluded deeper paths via @exclude)
    const parts = location.pathname.replace(/^\//, '').split('/');
    if (parts.length < 2 || !parts[0] || !parts[1]) return null;
    return { owner: parts[0], repo: parts[1] };
  }

  function isRepoRootPage() {
    const info = getRepoInfo();
    if (!info) return false;
    // Allow /owner/repo  and  /owner/repo?... but not sub-paths
    const path = location.pathname.replace(/\/$/, '');
    return path.split('/').length === 3; // ['', owner, repo]
  }

  // ─── Button injection ───────────────────────────────────────────────────────
  const BUTTON_ID = 'userscript-delete-repo-btn';

  function buildButton() {
    const wrapper = document.createElement('div');
    wrapper.id = BUTTON_ID;
    wrapper.style.cssText = [
      'margin-top: 16px',
      'padding-top: 16px',
      'border-top: 1px solid var(--borderColor-default, #d0d7de)',
    ].join(';');

    const btn = document.createElement('button');
    btn.textContent = 'Delete this repository';
    btn.type = 'button';
    btn.style.cssText = [
      'width: 100%',
      'padding: 6px 12px',
      'font-size: 12px',
      'font-weight: 500',
      'font-family: inherit',
      'line-height: 20px',
      'cursor: pointer',
      'border-radius: 6px',
      'border: 1px solid var(--button-danger-borderColor-rest, #cf222e)',
      'color: var(--button-danger-fgColor-rest, #cf222e)',
      'background: var(--button-danger-bgColor-rest, transparent)',
      'transition: background 120ms, color 120ms',
    ].join(';');

    btn.addEventListener('mouseenter', () => {
      btn.style.background = 'var(--button-danger-bgColor-hover, #cf222e)';
      btn.style.color = '#fff';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = 'var(--button-danger-bgColor-rest, transparent)';
      btn.style.color = 'var(--button-danger-fgColor-rest, #cf222e)';
    });

    btn.addEventListener('click', handleDelete);
    wrapper.appendChild(btn);
    return wrapper;
  }

  function injectButton() {
    if (!isRepoRootPage()) return;
    if (document.getElementById(BUTTON_ID)) return;

    // Contributors section lives inside the repo sidebar.
    // GitHub renders it as an <h2> containing "Contributors" inside a <section>
    // or as a borderBox with a heading link.  Try multiple selectors for
    // resilience across GitHub UI updates.
    const sidebar = document.querySelector(
      '[data-pjax="#repo-content-pjax-container"] aside, ' +
      '.Layout-sidebar, ' +
      '#repo-content-turbo-frame aside, ' +
      'aside.Layout-sidebar'
    );

    // Find the contributors heading anywhere in the sidebar / page right column
    const allHeadings = document.querySelectorAll(
      'h2.h4, h2.heading, .BorderGrid-cell h2, aside h2, .repository-content h2'
    );

    let contributorsCell = null;
    for (const h of allHeadings) {
      if (/^contributors$/i.test(h.textContent.trim())) {
        // Walk up to the nearest section/cell container
        contributorsCell = h.closest(
          '.BorderGrid-cell, section, .Box, [class*="sidebar"]'
        ) || h.parentElement;
        break;
      }
    }

    if (!contributorsCell) {
      // Fallback: append to the sidebar itself
      const fallback =
        sidebar ||
        document.querySelector('.Layout-sidebar') ||
        document.querySelector('[data-testid="repo-sidebar"]');
      if (!fallback) return;
      fallback.appendChild(buildButton());
      return;
    }

    // Insert after the contributors cell
    contributorsCell.insertAdjacentElement('afterend', buildButton());
  }

  // ─── Deletion logic ─────────────────────────────────────────────────────────
  async function handleDelete() {
    const info = getRepoInfo();
    if (!info) return;

    const { owner, repo } = info;

    // Double-confirm: ask user to type the repo name
    const typed = prompt(
      `You are about to PERMANENTLY DELETE:\n\n  ${owner}/${repo}\n\n` +
      `This cannot be undone.\n\n` +
      `Type the repository name "${repo}" to confirm:`
    );

    if (typed === null) return; // cancelled
    if (typed.trim() !== repo) {
      alert(`Confirmation failed — "${typed.trim()}" does not match "${repo}". Deletion cancelled.`);
      return;
    }

    const token = getToken();
    if (!token) {
      alert('No token provided. Deletion cancelled.');
      return;
    }

    const btn = document.querySelector(`#${BUTTON_ID} button`);
    if (btn) {
      btn.textContent = 'Deleting…';
      btn.disabled = true;
    }

    try {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });

      if (res.status === 204) {
        alert(`"${owner}/${repo}" has been deleted.`);
        location.href = `https://github.com/${owner}`;
      } else if (res.status === 403) {
        const body = await res.json().catch(() => ({}));
        alert(
          `Permission denied (HTTP 403).\n\n` +
          (body.message || '') + '\n\n' +
          'Make sure your token has the "delete_repo" scope and that you own this repository.'
        );
      } else if (res.status === 404) {
        alert(`Repository not found (HTTP 404). It may already have been deleted.`);
      } else {
        const body = await res.json().catch(() => ({}));
        alert(`Unexpected error (HTTP ${res.status}): ${body.message || 'unknown error'}`);
      }
    } catch (err) {
      alert(`Network error: ${err.message}`);
    } finally {
      if (btn) {
        btn.textContent = 'Delete this repository';
        btn.disabled = false;
      }
    }
  }

  // ─── Observer: re-inject on GitHub's SPA navigation ────────────────────────
  function tryInject() {
    if (isRepoRootPage()) injectButton();
  }

  // GitHub uses Turbo Drive; listen for navigation events
  document.addEventListener('turbo:load', tryInject);
  document.addEventListener('turbo:render', tryInject);
  // Legacy pjax
  document.addEventListener('pjax:end', tryInject);

  // Also watch for DOM mutations in case the sidebar is rendered late
  const observer = new MutationObserver(() => {
    if (!document.getElementById(BUTTON_ID)) tryInject();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Initial run
  tryInject();
})();
