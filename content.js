(function() {
  'use strict';

  const DEBUG = true;
  const log = (...args) => DEBUG && console.log('[MrPa]', ...args);
  const error = (...args) => console.error('[MrPa]', ...args);

  const INITIAL_LIMIT = 75;
  const INITIAL_DELAY = 100;
  const LOAD_MORE_DELAY = 200;
  const CACHE_DURATION = 5 * 60 * 1000;
  const CACHE_KEY_PREFIX = 'rpu_cache_';
  let loadingInterval = null;
  let loadingProgress = { comments: 0, posts: 0 };

  function getUsername() {
    const match = window.location.pathname.match(/\/(?:user|u)\/([^\/]+)/);
    return match ? match[1] : null;
  }

  function getSubpageType() {
    const path = window.location.pathname.toLowerCase();
    if (path.includes('/comments')) return 'comments';
    if (path.includes('/submitted') || path.includes('/posts')) return 'posts';
    return 'overview';
  }

  function isProfilePrivate() {
    if (document.querySelector('img[src*="snoo_wave.png"]')) return true;
    return document.body.innerHTML.includes('snoo_wave.png');
  }

  function updateStatusMessage(newText, isHtml = false) {
    const snooImg = document.querySelector('img[src*="snoo_wave.png"]');
    if (snooImg) {
      let container = snooImg.parentElement;
      for (let i = 0; i < 5 && container; i++) {
        const textElements = container.querySelectorAll('p, h1, h2, h3, span, div');
        for (const el of textElements) {
          if (el.contains(snooImg) || el.children.length > 3) continue;
          const text = el.textContent.trim();
          if ((text.length > 10 && text.length < 200 && !text.includes('http')) || el.id === 'rpu-status') {
            el.id = 'rpu-status';
            el.textContent = '';
            if (isHtml) {
              const span = document.createElement('span');
              span.textContent = newText.split('<br>')[0];
              el.appendChild(span);
              if (newText.includes('<br>')) {
                el.appendChild(document.createElement('br'));
                const subSpan = document.createElement('span');
                const subText = newText.split('<br>')[1].replace(/<[^>]*>/g, '');
                subSpan.style.fontSize = '0.9em';
                subSpan.style.opacity = '0.8';
                subSpan.textContent = subText;
                el.appendChild(subSpan);
              }
            } else {
              el.textContent = newText;
            }
            el.style.color = '#ff4500';
            el.style.fontWeight = '600';
            return el;
          }
        }
        container = container.parentElement;
      }
    }
    return null;
  }

  function startLoadingIndicator() {
    let dotCount = 1;
    loadingProgress = { comments: 0, posts: 0 };
    const statusEl = updateStatusMessage('Fetching user comments and posts.', false);
    if (!statusEl) return null;
    statusEl.id = 'rpu-status';

    const updateDisplay = () => {
      const dots = '.'.repeat(dotCount);
      const spaces = ' '.repeat(3 - dotCount);
      statusEl.textContent = '';
      statusEl.appendChild(document.createTextNode(`Fetching user comments and posts${dots}${spaces}`));
      statusEl.appendChild(document.createElement('br'));
      const progressSpan = document.createElement('span');
      progressSpan.style.fontSize = '0.9em';
      progressSpan.style.opacity = '0.8';
      progressSpan.textContent = `Found ${loadingProgress.comments}C / ${loadingProgress.posts}P`;
      statusEl.appendChild(progressSpan);
      dotCount = (dotCount % 3) + 1;
    };

    updateDisplay();
    loadingInterval = setInterval(updateDisplay, 500);
    return { stop: () => { if (loadingInterval) { clearInterval(loadingInterval); loadingInterval = null; } } };
  }

  function updateLoadingProgress(type, count) {
    loadingProgress[type] = count;
  }

  async function fetchSearchPage(url) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return new DOMParser().parseFromString(await response.text(), 'text/html');
    } catch (err) {
      error('Failed to fetch search page:', err);
      return null;
    }
  }

  function getNextPageUrl(doc) {
    const partial = doc.querySelector('faceplate-partial[src*="cursor="]');
    if (partial) {
      const src = partial.getAttribute('src');
      return src ? (src.startsWith('http') ? src : `https://www.reddit.com${src}`) : null;
    }
    return null;
  }

  function decodeHtmlEntities(str) {
    return str.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'");
  }

  function getCachedData(username) {
    try {
      const cached = sessionStorage.getItem(CACHE_KEY_PREFIX + username);
      if (!cached) return null;
      const data = JSON.parse(cached);
      if (Date.now() - data.timestamp > CACHE_DURATION) {
        sessionStorage.removeItem(CACHE_KEY_PREFIX + username);
        return null;
      }
      log(`Using cached data (age: ${Math.round((Date.now() - data.timestamp) / 1000)}s)`);
      return data;
    } catch (err) {
      return null;
    }
  }

  function setCachedData(username, posts, comments, postsNextUrl, commentsNextUrl, postsSeenIds, commentsSeenIds, commentSortsTried = []) {
    try {
      sessionStorage.setItem(CACHE_KEY_PREFIX + username, JSON.stringify({
        timestamp: Date.now(),
        posts, comments, postsNextUrl, commentsNextUrl,
        postsSeenIds: Array.from(postsSeenIds),
        commentsSeenIds: Array.from(commentsSeenIds),
        commentSortsTried: Array.from(commentSortsTried)
      }));
    } catch (err) {}
  }

  function updateCache(username) {
    if (!window.rpuState) return;
    setCachedData(username, window.rpuState.posts, window.rpuState.comments,
      window.rpuState.postsNextUrl, window.rpuState.commentsNextUrl,
      window.rpuState.postsSeenIds, window.rpuState.commentsSeenIds,
      window.rpuState.commentSortsTried || []);
  }

  function extractCommentsFromSearchHTML(doc) {
    const comments = [];
    doc.querySelectorAll('[data-testid="search-sdui-comment-unit"]').forEach(unit => {
      try {
        const tracker = unit.querySelector('search-telemetry-tracker[data-faceplate-tracking-context]');
        if (!tracker) return;
        const context = JSON.parse(decodeHtmlEntities(tracker.getAttribute('data-faceplate-tracking-context') || ''));
        if (!context.comment?.id) return;

        const commentId = context.comment.id;
        const contentEl = unit.querySelector(`[id^="search-comment-${commentId}"]`) || unit.querySelector('.i18n-search-comment-content');
        const body = contentEl?.textContent?.trim();
        if (!body) return;

        let score = 0;
        const votesContainer = unit.querySelector('p.text-neutral-content-weak');
        const voteEl = votesContainer?.querySelector('faceplate-number[number]');
        if (voteEl) score = parseInt(voteEl.getAttribute('number'), 10) || 0;

        let created_utc = Date.now() / 1000;
        const timeEls = Array.from(unit.querySelectorAll('faceplate-timeago[ts]'));
        const timeEl = timeEls.length ? timeEls[timeEls.length - 1] : null;
        if (timeEl?.getAttribute('ts')) created_utc = new Date(timeEl.getAttribute('ts')).getTime() / 1000;

        const postIdClean = (context.post?.id || '').replace('t3_', '');
        const commentIdClean = commentId.replace('t1_', '');
        const subreddit = context.subreddit?.name || '';

        comments.push({
          id: commentId, body, score, subreddit,
          post_title: context.post?.title || '',
          permalink: `/r/${subreddit}/comments/${postIdClean}/comment/${commentIdClean}/`,
          created_utc
        });
      } catch (err) {}
    });
    return comments;
  }

  function extractPostsFromSearchHTML(doc) {
    const posts = [];
    const seenIds = new Set();

    const extractPost = (context, parentContainer) => {
      if (!context.post?.id || !context.post?.title || context.comment) return null;
      const postId = context.post.id;
      if (seenIds.has(postId)) return null;
      seenIds.add(postId);

      let score = 0;
      const counterRow = parentContainer?.querySelector('[data-testid="search-counter-row"]');
      const scoreEl = counterRow?.querySelector('faceplate-number[number]');
      if (scoreEl) score = parseInt(scoreEl.getAttribute('number'), 10) || 0;

      let created_utc = Date.now() / 1000;
      const timeEl = parentContainer?.querySelector('faceplate-timeago[ts]');
      if (timeEl?.getAttribute('ts')) created_utc = new Date(timeEl.getAttribute('ts')).getTime() / 1000;

      const subreddit = context.subreddit?.name || '';
      return {
        id: postId, title: context.post.title, score, subreddit,
        permalink: `/r/${subreddit}/comments/${postId.replace('t3_', '')}/`,
        created_utc, nsfw: context.post?.nsfw || false
      };
    };

    let postUnits = doc.querySelectorAll('[data-testid="search-sdui-post-unit"]');
    if (!postUnits.length) postUnits = doc.querySelectorAll('shreddit-post');
    if (!postUnits.length) postUnits = doc.querySelectorAll('search-telemetry-tracker[view-events*="search/view/post"]');

    if (!postUnits.length) {
      doc.querySelectorAll('[data-faceplate-tracking-context]').forEach(tracker => {
        try {
          const context = JSON.parse(decodeHtmlEntities(tracker.getAttribute('data-faceplate-tracking-context') || ''));
          const parentContainer = tracker.closest('[data-testid]') || tracker.parentElement?.parentElement;
          const post = extractPost(context, parentContainer);
          if (post) posts.push(post);
        } catch (err) {}
      });
      return posts;
    }

    postUnits.forEach(unit => {
      try {
        const tracker = unit.querySelector('[data-faceplate-tracking-context]') || unit;
        const context = JSON.parse(decodeHtmlEntities(tracker.getAttribute('data-faceplate-tracking-context') || ''));
        const post = extractPost(context, unit);
        if (post) posts.push(post);
      } catch (err) {}
    });
    return posts;
  }

  async function fetchPostsFromUrl(username, searchUrl, limit, delay, existingPosts, existingSeenIds) {
    const allPosts = [...existingPosts];
    const seenIds = new Set(existingSeenIds);
    let nextPageUrl = null, currentUrl = searchUrl;

    while (currentUrl && allPosts.length < limit) {
      const doc = await fetchSearchPage(currentUrl);
      if (!doc) break;

      for (const post of extractPostsFromSearchHTML(doc)) {
        if (!seenIds.has(post.id)) { seenIds.add(post.id); allPosts.push(post); }
      }
      updateLoadingProgress('posts', allPosts.length);
      nextPageUrl = getNextPageUrl(doc);
      currentUrl = (allPosts.length < limit) ? nextPageUrl : null;
      if (currentUrl) await new Promise(r => setTimeout(r, delay));
    }
    return { posts: allPosts, url: searchUrl, nextPageUrl, seenIds };
  }

  async function fetchUserPosts(username, startUrl = null, limit = INITIAL_LIMIT, delay = INITIAL_DELAY, existingPosts = [], existingSeenIds = new Set()) {
    const allPosts = [...existingPosts];
    const seenIds = new Set(existingSeenIds);
    let lastNextPageUrl = null;
    const baseSearchUrl = `https://www.reddit.com/search/?q=${encodeURIComponent(`author:${username}`)}&type=posts&sort=new`;

    if (startUrl) return fetchPostsFromUrl(username, startUrl, limit, delay, allPosts, seenIds);

    const result = await fetchPostsFromUrl(username, baseSearchUrl, limit, delay, allPosts, seenIds);
    for (const post of result.posts) { if (!seenIds.has(post.id)) { seenIds.add(post.id); allPosts.push(post); } }
    result.seenIds.forEach(id => seenIds.add(id));
    lastNextPageUrl = result.nextPageUrl;
    return { posts: allPosts, url: baseSearchUrl, nextPageUrl: lastNextPageUrl, seenIds };
  }

  async function fetchCommentsFromUrl(username, searchUrl, limit, delay, existingComments, existingSeenIds) {
    const allComments = [...existingComments];
    const seenIds = new Set(existingSeenIds);
    let nextPageUrl = null, currentUrl = searchUrl;

    while (currentUrl && allComments.length < limit) {
      const doc = await fetchSearchPage(currentUrl);
      if (!doc) break;

      for (const comment of extractCommentsFromSearchHTML(doc)) {
        if (!seenIds.has(comment.id)) { seenIds.add(comment.id); allComments.push(comment); }
      }
      updateLoadingProgress('comments', allComments.length);
      nextPageUrl = getNextPageUrl(doc);
      currentUrl = (allComments.length < limit) ? nextPageUrl : null;
      if (currentUrl) await new Promise(r => setTimeout(r, delay));
    }
    return { comments: allComments, url: searchUrl, nextPageUrl, seenIds };
  }

  async function fetchUserComments(username, startUrl = null, limit = INITIAL_LIMIT, delay = INITIAL_DELAY, existingComments = [], existingSeenIds = new Set()) {
    const allComments = [...existingComments];
    const seenIds = new Set(existingSeenIds);
    let lastNextPageUrl = null;
    const baseSearchUrl = `https://www.reddit.com/search/?q=${encodeURIComponent(`author:${username}`)}&type=comments&sort=new`;

    if (startUrl) return fetchCommentsFromUrl(username, startUrl, limit, delay, allComments, seenIds);

    const result = await fetchCommentsFromUrl(username, baseSearchUrl, limit, delay, allComments, seenIds);
    for (const comment of result.comments) { if (!seenIds.has(comment.id)) { seenIds.add(comment.id); allComments.push(comment); } }
    result.seenIds.forEach(id => seenIds.add(id));
    lastNextPageUrl = result.nextPageUrl;
    return { comments: allComments, url: baseSearchUrl, nextPageUrl: lastNextPageUrl, seenIds };
  }

  function calculateStats(posts, comments) {
    return {
      postKarma: posts.reduce((sum, p) => sum + (p.score || 0), 0),
      commentKarma: comments.reduce((sum, c) => sum + (c.score || 0), 0),
      postCount: posts.length,
      commentCount: comments.length
    };
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function formatTimestamp(timestamp) {
    const now = Date.now() / 1000;
    const diff = now - timestamp;
    const date = new Date(timestamp * 1000);
    const dateStr = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;

    if (diff < 60) return 'just now';
    if (diff < 3600) { const m = Math.floor(diff / 60); return `${m} minute${m !== 1 ? 's' : ''} ago`; }
    if (diff < 86400) { const h = Math.floor(diff / 3600); return `${h} hour${h !== 1 ? 's' : ''} ago`; }

    const days = Math.floor(diff / 86400);
    if (days < 30) return `${days} day${days !== 1 ? 's' : ''} ago - ${dateStr}`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months} month${months !== 1 ? 's' : ''} ago - ${dateStr}`;
    const years = Math.floor(days / 365);
    return `${years} year${years !== 1 ? 's' : ''} ago - ${dateStr}`;
  }

  function createPostElement(post) {
    const postDate = formatTimestamp(post.created_utc);
    const postUrl = `https://www.reddit.com${post.permalink}`;
    return `
      <div class="rpu-item" style="background: var(--color-neutral-background, #1a1a1b); border: 1px solid var(--color-neutral-border, #343536); border-radius: 8px; padding: 16px; margin-bottom: 8px;">
        <div style="display: flex; gap: 12px;">
          <div style="display: flex; flex-direction: column; align-items: center; min-width: 40px;">
            <span style="color: #818384; font-weight: 600; font-size: 14px;">↑</span>
            <span style="color: #818384; font-weight: 600; font-size: 12px;">${post.score}</span>
          </div>
          <div style="flex: 1;">
            <div style="margin-bottom: 4px;">
              <a href="https://www.reddit.com/r/${post.subreddit}" style="color: #4fbcff; text-decoration: none; font-size: 12px; font-weight: 500;">r/${post.subreddit}</a>
              <span style="color: #818384; font-size: 12px; margin-left: 8px;">• ${postDate}</span>
            </div>
            <a href="${postUrl}" target="_blank" style="color: #d7dadc; text-decoration: none; font-size: 16px; font-weight: 500; line-height: 1.4; display: block;">${escapeHtml(post.title)}</a>
          </div>
        </div>
      </div>`;
  }

  function createCommentElement(comment) {
    const commentDate = formatTimestamp(comment.created_utc);
    const commentUrl = `https://www.reddit.com${comment.permalink}`;
    let bodyText = comment.body || '';
    if (bodyText.length > 300) bodyText = bodyText.substring(0, 300) + '...';

    return `
      <div class="rpu-item" style="background: var(--color-neutral-background, #1a1a1b); border: 1px solid var(--color-neutral-border, #343536); border-radius: 8px; padding: 16px; margin-bottom: 8px;">
        <div style="margin-bottom: 8px;">
          <a href="https://www.reddit.com/r/${comment.subreddit}" style="color: #4fbcff; text-decoration: none; font-size: 12px; font-weight: 500;">r/${comment.subreddit}</a>
          <span style="color: #818384; font-size: 12px; margin-left: 8px;">• ${commentDate}</span>
        </div>
        ${comment.post_title ? `<a href="${commentUrl}" target="_blank" style="color: #818384; font-size: 13px; margin-bottom: 8px; font-style: italic; display: block; text-decoration: none;">${escapeHtml(comment.post_title)}</a>` : ''}
        <a href="${commentUrl}" target="_blank" style="color: #d7dadc; font-size: 14px; line-height: 1.6; margin-bottom: 8px; white-space: pre-wrap; word-wrap: break-word; display: block; text-decoration: none;">${escapeHtml(bodyText)}</a>
        <div style="display: flex; gap: 12px; align-items: center;">
          <span style="color: #ff4500; font-weight: 600; font-size: 12px;">↑ ${comment.score}</span>
          <a href="${commentUrl}" target="_blank" style="color: #4fbcff; text-decoration: none; font-size: 12px;">View context</a>
        </div>
      </div>`;
  }

  function injectProfileData(username, posts, comments, stats, postsUrl, commentsUrl, postsNextUrl, commentsNextUrl, postsSeenIds, commentsSeenIds, commentSortsTried = new Set()) {
    const allElements = document.querySelectorAll('*');
    for (const el of allElements) {
      if (el.textContent.includes('likes to keep their posts hidden') && el.children.length < 10) { el.remove(); break; }
    }

    let targetDiv = document.querySelector('div[rpl].flex.flex-col.items-center.w-full') ||
                    document.querySelector('shreddit-profile-overview') ||
                    document.querySelector('main') ||
                    document.querySelector('#main-content');

    if (!targetDiv) {
      const main = document.querySelector('main');
      if (main) { targetDiv = document.createElement('div'); main.appendChild(targetDiv); }
      else return;
    }

    const buttonStyle = 'padding: 6px 14px; background: #ff4500; color: white; border: none; border-radius: 16px; cursor: pointer; font-weight: 600; font-size: 12px; line-height: 1; display: inline-flex; align-items: center; justify-content: center;';
    const buttonDisabledStyle = 'padding: 6px 14px; background: #343536; color: #818384; border: none; border-radius: 16px; cursor: not-allowed; font-weight: 600; font-size: 12px; line-height: 1; display: inline-flex; align-items: center; justify-content: center;';
    const sortButtonActive = 'padding: 6px 12px; background: #ff4500; color: white; border: none; border-radius: 16px; cursor: pointer; font-weight: 600; font-size: 12px; line-height: 1; display: inline-flex; align-items: center; justify-content: center;';
    const sortButtonInactive = 'padding: 6px 12px; background: transparent; color: #818384; border: 1px solid #343536; border-radius: 16px; cursor: pointer; font-weight: 500; font-size: 12px; line-height: 1; display: inline-flex; align-items: center; justify-content: center;';

    const controlBar = document.createElement('div');
    controlBar.style.cssText = 'margin: 12px 16px; padding: 10px 16px; background: var(--color-neutral-background-weak, #1a1a1b); border: 1px solid var(--color-neutral-border, #343536); border-radius: 8px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px;';
    
    const statsSection = document.createElement('div');
    statsSection.style.cssText = 'display: flex; align-items: center; gap: 8px; font-size: 12px; color: #818384;';
    statsSection.title = 'Only the newest ~75 posts and comments are fetched by default';
    
    const postsLink = document.createElement('a');
    postsLink.href = postsUrl;
    postsLink.target = '_blank';
    postsLink.style.cssText = 'color: #4fbcff; text-decoration: none;';
    const postsCountSpan = document.createElement('span');
    postsCountSpan.id = 'rpu-post-count';
    postsCountSpan.textContent = stats.postCount;
    postsLink.appendChild(postsCountSpan);
    postsLink.appendChild(document.createTextNode(' Posts'));
    
    const commentsLink = document.createElement('a');
    commentsLink.href = commentsUrl;
    commentsLink.target = '_blank';
    commentsLink.style.cssText = 'color: #4fbcff; text-decoration: none;';
    const commentsCountSpan = document.createElement('span');
    commentsCountSpan.id = 'rpu-comment-count';
    commentsCountSpan.textContent = stats.commentCount;
    commentsLink.appendChild(commentsCountSpan);
    commentsLink.appendChild(document.createTextNode(' Comments'));
    
    statsSection.appendChild(postsLink);
    statsSection.appendChild(document.createTextNode(' · '));
    statsSection.appendChild(commentsLink);

    const controlsSection = document.createElement('div');
    controlsSection.style.cssText = 'display: flex; align-items: center; gap: 8px;';

    const sortNewBtn = document.createElement('button');
    sortNewBtn.textContent = 'New';
    sortNewBtn.style.cssText = sortButtonActive;

    const sortTopBtn = document.createElement('button');
    sortTopBtn.textContent = 'Top';
    sortTopBtn.style.cssText = sortButtonInactive;

    const separator = document.createElement('span');
    separator.style.cssText = 'width: 1px; height: 16px; background: #343536; margin: 0 4px;';

    const loadMorePostsBtn = document.createElement('button');
    loadMorePostsBtn.id = 'rpu-load-more-posts';
    loadMorePostsBtn.textContent = postsNextUrl ? 'Load more posts' : 'No more posts';
    loadMorePostsBtn.style.cssText = postsNextUrl ? buttonStyle : buttonDisabledStyle;
    loadMorePostsBtn.disabled = !postsNextUrl;

    const loadMoreCommentsBtn = document.createElement('button');
    loadMoreCommentsBtn.id = 'rpu-load-more-comments';

    const initialCommentSorts = (commentSortsTried instanceof Set) ? commentSortsTried : new Set(commentSortsTried || ['new']);
    const COMMENT_SORTS = ['new','relevance','top'];
    const anyMoreCommentSorts = COMMENT_SORTS.some(s => !initialCommentSorts.has(s));
    const canContinueComments = !!commentsNextUrl || anyMoreCommentSorts;

    loadMoreCommentsBtn.textContent = canContinueComments ? (commentsNextUrl ? 'Load more comments' : 'Load more comments') : 'No more comments';
    loadMoreCommentsBtn.style.cssText = canContinueComments ? buttonStyle : buttonDisabledStyle;
    loadMoreCommentsBtn.disabled = !canContinueComments;

    controlsSection.appendChild(sortNewBtn);
    controlsSection.appendChild(sortTopBtn);
    controlsSection.appendChild(separator);
    controlsSection.appendChild(loadMorePostsBtn);
    controlsSection.appendChild(loadMoreCommentsBtn);
    
    controlBar.appendChild(statsSection);
    controlBar.appendChild(controlsSection);

    const feedContainer = document.createElement('div');
    feedContainer.id = 'rpu-feed';
    feedContainer.style.cssText = 'padding: 0 16px;';

    const subpage = getSubpageType();
    if (subpage === 'comments') loadMorePostsBtn.style.display = 'none';
    else if (subpage === 'posts') loadMoreCommentsBtn.style.display = 'none';

    window.rpuState = {
      username, posts: [...posts], comments: [...comments],
      postsNextUrl, commentsNextUrl,
      postsSeenIds: new Set(postsSeenIds), commentsSeenIds: new Set(commentsSeenIds),
      sortOrder: 'new',
      commentSortsTried: new Set(initialCommentSorts)
    };

    const updateFeedDisplay = () => {
      const feed = document.getElementById('rpu-feed');
      if (!feed) return;

      const currentSubpage = getSubpageType();
      let postsToShow = currentSubpage === 'comments' ? [] : window.rpuState.posts;
      let commentsToShow = currentSubpage === 'posts' ? [] : window.rpuState.comments;

      const allContent = [
        ...postsToShow.map(p => ({ ...p, type: 'post' })),
        ...commentsToShow.map(c => ({ ...c, type: 'comment' }))
      ];

      if (window.rpuState.sortOrder === 'top') allContent.sort((a, b) => b.score - a.score);
      else allContent.sort((a, b) => b.created_utc - a.created_utc);

      feed.textContent = '';
      if (allContent.length === 0) {
        const emptyDiv = document.createElement('div');
        emptyDiv.style.cssText = 'padding: 40px; text-align: center; color: #818384;';
        emptyDiv.textContent = 'No content found';
        feed.appendChild(emptyDiv);
      } else {
        const fragment = document.createDocumentFragment();
        const parser = new DOMParser();
        allContent.forEach(item => {
          const htmlString = item.type === 'post' ? createPostElement(item) : createCommentElement(item);
          const doc = parser.parseFromString(htmlString, 'text/html');
          const element = doc.body.firstChild;
          if (element) fragment.appendChild(element);
        });
        feed.appendChild(fragment);
      }

      const postCount = document.getElementById('rpu-post-count');
      const commentCount = document.getElementById('rpu-comment-count');
      if (postCount) postCount.textContent = postsToShow.length;
      if (commentCount) commentCount.textContent = commentsToShow.length;

      const postsBtn = document.getElementById('rpu-load-more-posts');
      const commentsBtn = document.getElementById('rpu-load-more-comments');
      if (postsBtn) postsBtn.style.display = currentSubpage === 'comments' ? 'none' : '';
      if (commentsBtn) commentsBtn.style.display = currentSubpage === 'posts' ? 'none' : '';
    };

    loadMorePostsBtn.addEventListener('click', async () => {
      if (!window.rpuState.postsNextUrl) return;
      loadMorePostsBtn.textContent = 'Loading...';
      loadMorePostsBtn.disabled = true;
      loadMorePostsBtn.style.cssText = buttonDisabledStyle;

      try {
        const result = await fetchUserPosts(window.rpuState.username, window.rpuState.postsNextUrl, Infinity, LOAD_MORE_DELAY, window.rpuState.posts, window.rpuState.postsSeenIds);
        window.rpuState.posts = result.posts;
        window.rpuState.postsNextUrl = result.nextPageUrl;
        window.rpuState.postsSeenIds = result.seenIds;
        updateCache(window.rpuState.username);
        updateFeedDisplay();
        loadMorePostsBtn.textContent = result.nextPageUrl ? 'Load more posts' : 'No posts';
        loadMorePostsBtn.disabled = !result.nextPageUrl;
        loadMorePostsBtn.style.cssText = result.nextPageUrl ? buttonStyle : buttonDisabledStyle;
      } catch (err) {
        loadMorePostsBtn.textContent = 'Error - try again';
        loadMorePostsBtn.disabled = false;
        loadMorePostsBtn.style.cssText = buttonStyle;
      }
    });

    loadMoreCommentsBtn.addEventListener('click', async () => {
      loadMoreCommentsBtn.textContent = 'Loading...';
      loadMoreCommentsBtn.disabled = true;
      loadMoreCommentsBtn.style.cssText = buttonDisabledStyle;

      try {
        const username = window.rpuState.username;
        let candidateNextUrl = window.rpuState.commentsNextUrl || null;

        if (window.rpuState.commentsNextUrl) {
          const result = await fetchUserComments(username, window.rpuState.commentsNextUrl, Infinity, LOAD_MORE_DELAY, window.rpuState.comments, window.rpuState.commentsSeenIds);
          window.rpuState.comments = result.comments;
          window.rpuState.commentsSeenIds = result.seenIds;
          candidateNextUrl = candidateNextUrl || result.nextPageUrl || null;
          updateCache(username);
        }
        const otherSorts = ['relevance', 'top'];
        for (const sort of otherSorts) {
          if (window.rpuState.commentSortsTried.has(sort)) continue;
          const altUrl = `https://www.reddit.com/search/?q=${encodeURIComponent(`author:${username}`)}&type=comments&sort=${sort}`;
          const res = await fetchUserComments(username, altUrl, Infinity, LOAD_MORE_DELAY, window.rpuState.comments, window.rpuState.commentsSeenIds);
          window.rpuState.comments = res.comments;
          window.rpuState.commentsSeenIds = res.seenIds;
          window.rpuState.commentSortsTried.add(sort);
          candidateNextUrl = candidateNextUrl || res.nextPageUrl || null;
          updateCache(username);
        }

        window.rpuState.commentsNextUrl = candidateNextUrl;
        updateFeedDisplay();

        const anyMoreSorts = ['new','relevance','top'].some(s => !window.rpuState.commentSortsTried.has(s));
        const canContinue = !!window.rpuState.commentsNextUrl || anyMoreSorts;

        loadMoreCommentsBtn.textContent = canContinue ? '+Comments' : 'No comments';
        loadMoreCommentsBtn.disabled = !canContinue;
        loadMoreCommentsBtn.style.cssText = canContinue ? buttonStyle : buttonDisabledStyle;
      } catch (err) {
        console.error('[Reddit Profile Unveiler] Failed loading more comments', err);
        loadMoreCommentsBtn.textContent = 'Error - try again';
        loadMoreCommentsBtn.disabled = false;
        loadMoreCommentsBtn.style.cssText = buttonStyle;
      }
    });

    sortNewBtn.addEventListener('click', () => {
      if (window.rpuState.sortOrder === 'new') return;
      window.rpuState.sortOrder = 'new';
      sortNewBtn.style.cssText = sortButtonActive;
      sortTopBtn.style.cssText = sortButtonInactive;
      updateFeedDisplay();
    });

    sortTopBtn.addEventListener('click', () => {
      if (window.rpuState.sortOrder === 'top') return;
      window.rpuState.sortOrder = 'top';
      sortTopBtn.style.cssText = sortButtonActive;
      sortNewBtn.style.cssText = sortButtonInactive;
      updateFeedDisplay();
    });

    let postsToShow = subpage === 'comments' ? [] : posts;
    let commentsToShow = subpage === 'posts' ? [] : comments;
    const allContent = [...postsToShow.map(p => ({ ...p, type: 'post' })), ...commentsToShow.map(c => ({ ...c, type: 'comment' }))].sort((a, b) => b.created_utc - a.created_utc);
    
    if (allContent.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.style.cssText = 'padding: 40px; text-align: center; color: #818384;';
      emptyDiv.textContent = 'No content found';
      feedContainer.appendChild(emptyDiv);
    } else {
      const fragment = document.createDocumentFragment();
      const parser = new DOMParser();
      allContent.forEach(item => {
        const htmlString = item.type === 'post' ? createPostElement(item) : createCommentElement(item);
        const doc = parser.parseFromString(htmlString, 'text/html');
        const element = doc.body.firstChild;
        if (element) fragment.appendChild(element);
      });
      feedContainer.appendChild(fragment);
    }

    targetDiv.textContent = '';
    targetDiv.appendChild(controlBar);
    targetDiv.appendChild(feedContainer);
  }

  async function main() {
    const username = getUsername();
    if (!username) return;

    const subpage = getSubpageType();
    let attempts = 0;
    while (attempts < 2) {
      await new Promise(r => setTimeout(r, 500));
      if (isProfilePrivate()) break;
      attempts++;
    }

    if (!isProfilePrivate()) return;

    const cachedData = getCachedData(username);
    let posts = [], comments = [];
    let postsUrl = `https://www.reddit.com/search/?q=${encodeURIComponent(`author:${username}`)}&type=posts&sort=new`;
    let commentsUrl = `https://www.reddit.com/search/?q=${encodeURIComponent(`author:${username}`)}&type=comments&sort=new`;
    let postsNextUrl = null, commentsNextUrl = null;
    let postsSeenIds = new Set(), commentsSeenIds = new Set();

    if (cachedData) {
      posts = cachedData.posts || [];
      comments = cachedData.comments || [];
      postsNextUrl = cachedData.postsNextUrl;
      commentsNextUrl = cachedData.commentsNextUrl;
      postsSeenIds = new Set(cachedData.postsSeenIds || []);
      commentsSeenIds = new Set(cachedData.commentsSeenIds || []);
      var commentSortsTried = new Set(cachedData.commentSortsTried || ['new']);

      const needPosts = (subpage === 'overview' || subpage === 'posts') && posts.length === 0;
      const needComments = (subpage === 'overview' || subpage === 'comments') && comments.length === 0;

      if (needPosts || needComments) {
        const loadingIndicator = startLoadingIndicator();
        if (needPosts) {
          const r = await fetchUserPosts(username);
          posts = r.posts; postsNextUrl = r.nextPageUrl; postsSeenIds = r.seenIds;
        }
        if (needComments) {
          const r = await fetchUserComments(username);
          comments = r.comments; commentsNextUrl = r.nextPageUrl; commentsSeenIds = r.seenIds;
        }
        if (loadingIndicator) loadingIndicator.stop();
        setCachedData(username, posts, comments, postsNextUrl, commentsNextUrl, postsSeenIds, commentsSeenIds, commentSortsTried);
      }
    } else {
      const loadingIndicator = startLoadingIndicator();
      const fetchPosts = subpage === 'overview' || subpage === 'posts';
      const fetchComments = subpage === 'overview' || subpage === 'comments';
      var commentSortsTried = new Set(['new']);

      const [postsResult, commentsResult] = await Promise.all([
        fetchPosts ? fetchUserPosts(username) : Promise.resolve({ posts: [], nextPageUrl: null, seenIds: new Set() }),
        fetchComments ? fetchUserComments(username) : Promise.resolve({ comments: [], nextPageUrl: null, seenIds: new Set() })
      ]);

      if (loadingIndicator) loadingIndicator.stop();
      posts = postsResult.posts || [];
      comments = commentsResult.comments || [];
      postsUrl = postsResult.url || postsUrl;
      commentsUrl = commentsResult.url || commentsUrl;
      postsNextUrl = postsResult.nextPageUrl;
      commentsNextUrl = commentsResult.nextPageUrl;
      postsSeenIds = postsResult.seenIds || new Set();
      commentsSeenIds = commentsResult.seenIds || new Set();
      setCachedData(username, posts, comments, postsNextUrl, commentsNextUrl, postsSeenIds, commentsSeenIds, commentSortsTried);
    }

    if (posts.length === 0 && comments.length === 0) {
      updateStatusMessage('No data found about user.');
      return;
    }

    injectProfileData(username, posts, comments, calculateStats(posts, comments), postsUrl, commentsUrl, postsNextUrl, commentsNextUrl, postsSeenIds, commentsSeenIds, commentSortsTried);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main);
  else main();

  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) { lastUrl = location.href; setTimeout(main, 500); }
  }).observe(document, { subtree: true, childList: true });
})();
