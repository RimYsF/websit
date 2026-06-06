const SUPABASE_URL = "https://xrwzgtzdtkvgjrkzeztn.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_UYKQPoCWBdRCWLfwJBCdsw_jMF1mMpt";
const ONBOARDING_STORAGE_KEY = "builder-story-pending-onboarding-v1";
const AVATAR_STORAGE_PREFIX = "builder-story-avatar:";
const reactionTypes = ["Fire"];

const supabaseClient = window.supabase?.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);

let posts = [];
let knownProfiles = new Map();
let currentSession = null;
let currentProfile = null;
let followingIds = new Set();
let activeView = "feed";
let activeFilter = "latest";
let imageFilePreview = "";
let imageReadToken = 0;
let lastScrollY = window.scrollY;
let mobileMenuVisibility = 1;
let animatedReactionPostId = null;
let activeReplyTarget = null;
let activeProfilePopover = null;
let activeProfileHandle = "";
let feedProfileHandle = null;
let isLoading = true;
const openCommentPostIds = new Set();

const postList = document.querySelector("#post-list");
const feedProfileView = document.querySelector("#feed-profile-view");
const profilePostList = document.querySelector("#profile-post-list");
const profileCard = document.querySelector(".profile-card");
const profileAvatar = document.querySelector(".profile-avatar");
const profileTitle = document.querySelector("#profile-title");
const profileBio = document.querySelector(".profile-card p");
const profileStats = document.querySelector(".profile-stats");
const composer = document.querySelector("#composer");
const textInput = document.querySelector("#post-text");
const imageUrlInput = document.querySelector("#image-url");
const imageFileInput = document.querySelector("#image-file");
const externalUrlInput = document.querySelector("#external-url");
const imagePreview = document.querySelector("#image-preview");
const composerPreview = document.querySelector("#composer-preview");
const rail = document.querySelector(".rail");
const mobileMenuButton = document.querySelector("[data-mobile-menu]");
const openSignupButtons = document.querySelectorAll("[data-open-signup]");
const googleSigninButton = document.querySelector("[data-google-signin]");
const authStatus = document.querySelector("[data-auth-status]");
const authSignedOut = document.querySelector("[data-auth-signed-out]");
const authSignedIn = document.querySelector("[data-auth-signed-in]");
const authName = document.querySelector("[data-auth-name]");
const authHandle = document.querySelector("[data-auth-handle]");
const authAvatar = document.querySelector("[data-auth-avatar]");
const authSignout = document.querySelector("[data-auth-signout]");
const signupModal = document.querySelector("[data-signup-modal]");
const signupNameInput = document.querySelector("[data-signup-name]");
const signupHandlePreview = document.querySelector("[data-signup-handle]");
const signupError = document.querySelector("[data-signup-error]");
const signupAvatarInput = document.querySelector("[data-signup-avatar-input]");
const signupAvatarPreview = document.querySelector("[data-signup-avatar-preview]");
const signupCloseTargets = document.querySelectorAll("[data-signup-close]");
const MOBILE_MENU_HIDE_DISTANCE = 220;

let signupAvatarDataUrl = "";

function setStatus(message) {
  if (authStatus) authStatus.textContent = message || "";
}

function normalizeUsername(value) {
  return String(value || "")
    .replace(/^@/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
}

function normalizeDisplayName(value) {
  return String(value || "").trim().replace(/^@+/, "").trim().slice(0, 80);
}

function getAvatarFallback(value) {
  return String(value || "Builder").trim().slice(0, 1).toUpperCase() || "B";
}

function readJsonStorage(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}

function writeJsonStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    setStatus("Local storage is full. Try a smaller avatar.");
  }
}

function getLocalAvatar(userId) {
  if (!userId) return "";
  try {
    return localStorage.getItem(`${AVATAR_STORAGE_PREFIX}${userId}`) || "";
  } catch {
    return "";
  }
}

function setLocalAvatar(userId, dataUrl) {
  if (!userId || !dataUrl) return;
  try {
    localStorage.setItem(`${AVATAR_STORAGE_PREFIX}${userId}`, dataUrl);
  } catch {
    setStatus("Avatar was too large to save locally.");
  }
}

function renderAvatarContent(userLike) {
  const image = userLike?.avatarImage || getLocalAvatar(userLike?.id);
  if (image) {
    return `<img src="${escapeHtml(image)}" alt="" loading="lazy" decoding="async" />`;
  }
  return escapeHtml(userLike?.avatar || getAvatarFallback(userLike?.name || userLike?.author));
}

function renderAvatarInto(element, userLike) {
  if (!element) return;
  element.innerHTML = renderAvatarContent(userLike);
}

function profileToUser(profile) {
  if (!profile) return null;
  const name = profile.display_name || profile.username || "Builder";
  return {
    id: profile.id,
    name,
    username: profile.username,
    handle: `@${profile.username}`,
    avatar: getAvatarFallback(name),
    avatarImage: getLocalAvatar(profile.id),
    bio: profile.bio || profile.headline || "",
    postCount: profile.posts_count || 0,
    followersCount: profile.followers_count || 0,
    followingCount: profile.following_count || 0,
    isFollowing: followingIds.has(profile.id),
  };
}

function dbReactionToUi(value) {
  return value === "fire" ? "Fire" : null;
}

function uiReactionToDb(value) {
  return value === "Fire" ? "fire" : value.toLowerCase();
}

function timeAgo(timestamp) {
  const time = new Date(timestamp).getTime();
  const diff = Math.max(1, Math.floor((Date.now() - time) / 1000));
  if (diff < 60) return `${diff}s`;
  const minutes = Math.floor(diff / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function normalizeExternalUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(withProtocol).toString();
  } catch {
    return "";
  }
}

function getDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function safeUrlPath(url) {
  try {
    return new URL(url).pathname.split("/").filter(Boolean);
  } catch {
    return [];
  }
}

function makeLinkPreview(url) {
  const normalizedUrl = normalizeExternalUrl(url);
  if (!normalizedUrl) return null;

  const domain = getDomain(normalizedUrl);
  const isGithub = domain === "github.com";
  const path = safeUrlPath(normalizedUrl);
  const repoName = isGithub && path.length >= 2 ? `${path[0]}/${path[1]}` : domain;

  if (isGithub) {
    return {
      url: normalizedUrl,
      site: "GitHub",
      title: repoName,
      desc: "Repository shared on Builder Story. Open the source, inspect the code and follow the builder.",
      image:
        "https://images.unsplash.com/photo-1618401471353-b98afee0b2eb?auto=format&fit=crop&w=520&q=72",
    };
  }

  return {
    url: normalizedUrl,
    site: domain,
    title: `Shared from ${domain}`,
    desc: "OpenGraph preview placeholder. Backend metadata fetching can replace this fallback later.",
    image:
      "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=520&q=72",
  };
}

function isRenderableImageUrl(value) {
  const image = String(value || "").trim();
  return (
    image.startsWith("data:image/") ||
    image.startsWith("blob:") ||
    image.startsWith("http://") ||
    image.startsWith("https://")
  );
}

function getImageAttachment() {
  if (isRenderableImageUrl(imageFilePreview)) return imageFilePreview;
  const imageUrl = imageUrlInput.value.trim();
  return isRenderableImageUrl(imageUrl) ? imageUrl : "";
}

async function initializeApp() {
  if (!supabaseClient) {
    isLoading = false;
    setStatus("Supabase SDK did not load.");
    renderAll();
    return;
  }

  const { data, error } = await supabaseClient.auth.getSession();
  if (error) setStatus(error.message);
  currentSession = data?.session || null;
  await loadAppData();

  supabaseClient.auth.onAuthStateChange(async (_event, session) => {
    const previousUserId = currentSession?.user?.id || "";
    const nextUserId = session?.user?.id || "";
    currentSession = session;
    await loadAppData({ showLoading: previousUserId !== nextUserId });
  });
}

async function ensureCurrentProfile() {
  currentProfile = null;
  if (!currentSession?.user) return;

  const { data, error } = await supabaseClient
    .from("profiles")
    .select("*")
    .eq("id", currentSession.user.id)
    .maybeSingle();

  if (error) {
    setStatus(error.message);
    return;
  }

  if (data) {
    currentProfile = data;
    activeProfileHandle ||= `@${data.username}`;
    return;
  }

  const emailName = currentSession.user.email?.split("@")[0] || "builder";
  const fallbackUsername = `${normalizeUsername(emailName).slice(0, 23) || "user"}_${currentSession.user.id.replaceAll("-", "").slice(0, 8)}`;
  const { data: created, error: createError } = await supabaseClient
    .from("profiles")
    .insert({
      id: currentSession.user.id,
      username: fallbackUsername,
      display_name: currentSession.user.user_metadata?.display_name || fallbackUsername,
    })
    .select("*")
    .single();

  if (createError) {
    setStatus(createError.message);
    return;
  }

  currentProfile = created;
  activeProfileHandle = `@${created.username}`;
}

async function applyPendingOnboarding() {
  if (!currentProfile) return;

  const pending = readJsonStorage(ONBOARDING_STORAGE_KEY);
  if (!pending?.displayName || !pending?.username) return;

  const { data, error } = await supabaseClient
    .from("profiles")
    .update({
      display_name: pending.displayName,
      username: pending.username,
    })
    .eq("id", currentProfile.id)
    .select("*")
    .single();

  if (error) {
    setStatus(error.message);
    return;
  }

  if (pending.avatarDataUrl) {
    setLocalAvatar(currentProfile.id, pending.avatarDataUrl);
  }

  currentProfile = data;
  activeProfileHandle = `@${data.username}`;
  localStorage.removeItem(ONBOARDING_STORAGE_KEY);
}

async function loadAppData({ showLoading = true } = {}) {
  if (showLoading) {
    isLoading = true;
    renderAll();
  }

  await ensureCurrentProfile();
  await applyPendingOnboarding();
  await loadFollowing();
  await loadProfiles();
  await loadPosts();

  updateAuthUi();
  isLoading = false;
  const restoreScroll = showLoading ? null : { left: window.scrollX, top: window.scrollY };
  renderAll();
  if (restoreScroll) window.scrollTo(restoreScroll.left, restoreScroll.top);
}

async function loadFollowing() {
  followingIds = new Set();
  if (!currentProfile) return;

  const { data, error } = await supabaseClient
    .from("follows")
    .select("following_id")
    .eq("follower_id", currentProfile.id);

  if (error) {
    setStatus(error.message);
    return;
  }
  followingIds = new Set((data || []).map((item) => item.following_id));
}

async function loadProfiles() {
  knownProfiles = new Map();
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("id, username, display_name, bio, headline, posts_count, followers_count, following_count");

  if (error) {
    setStatus(error.message);
    return;
  }

  (data || []).forEach((profile) => {
    knownProfiles.set(`@${profile.username}`.toLowerCase(), profileToUser(profile));
  });
}

async function loadPosts() {
  const viewName = activeFilter === "following" && currentProfile ? "feed_following" : "feed_latest";
  const { data: rows, error } = await supabaseClient
    .from(viewName)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    setStatus(error.message);
    posts = [];
    return;
  }

  const postIds = (rows || []).map((row) => row.id);
  const [comments, reactions] = await Promise.all([
    fetchComments(postIds),
    fetchReactions(postIds),
  ]);

  posts = (rows || []).map((row) => mapPostRow(row, comments.get(row.id) || [], reactions.get(row.id)));
}

async function fetchComments(postIds) {
  const commentsByPost = new Map();
  if (!postIds.length) return commentsByPost;

  const { data, error } = await supabaseClient
    .from("comments")
    .select(
      "id, post_id, parent_comment_id, body, likes_count, created_at, author:profiles!comments_author_id_fkey(id, username, display_name, bio, headline, posts_count, followers_count, following_count)"
    )
    .in("post_id", postIds)
    .eq("status", "published")
    .order("created_at", { ascending: true });

  if (error) {
    setStatus(error.message);
    return commentsByPost;
  }

  const commentRows = data || [];
  const likedIds = await fetchLikedCommentIds(commentRows.map((comment) => comment.id));
  const byId = new Map();

  commentRows.forEach((comment) => {
    const shaped = mapCommentRow(comment, likedIds.has(comment.id));
    byId.set(comment.id, shaped);
  });

  commentRows.forEach((comment) => {
    const shaped = byId.get(comment.id);
    if (comment.parent_comment_id) {
      byId.get(comment.parent_comment_id)?.replies.push(shaped);
      return;
    }

    if (!commentsByPost.has(comment.post_id)) commentsByPost.set(comment.post_id, []);
    commentsByPost.get(comment.post_id).push(shaped);
  });

  return commentsByPost;
}

async function fetchLikedCommentIds(commentIds) {
  if (!currentProfile || !commentIds.length) return new Set();

  const { data, error } = await supabaseClient
    .from("comment_likes")
    .select("comment_id")
    .eq("user_id", currentProfile.id)
    .in("comment_id", commentIds);

  if (error) {
    setStatus(error.message);
    return new Set();
  }
  return new Set((data || []).map((item) => item.comment_id));
}

async function fetchReactions(postIds) {
  const reactionsByPost = new Map();
  if (!postIds.length) return reactionsByPost;

  const { data, error } = await supabaseClient
    .from("post_reactions")
    .select("post_id, reaction_type")
    .in("post_id", postIds);

  if (error) {
    setStatus(error.message);
    return reactionsByPost;
  }

  (data || []).forEach((reaction) => {
    const current = reactionsByPost.get(reaction.post_id) || { Fire: 0 };
    if (reaction.reaction_type === "fire") current.Fire += 1;
    reactionsByPost.set(reaction.post_id, current);
  });

  return reactionsByPost;
}

function mapPostRow(row, comments, reactions) {
  const authorName = row.author?.display_name || row.author?.username || "Builder";
  const media = Array.isArray(row.media) ? row.media : [];
  const image = media.find((item) => item.cdn_url || item.public_url);
  const link = row.link_preview
    ? {
        url: row.link_preview.normalized_url || row.link_preview.original_url,
        site: row.link_preview.site_name || row.link_preview.domain,
        title: row.link_preview.title || row.link_preview.domain,
        desc: row.link_preview.description || "Preview is unavailable. Open the original source.",
        image: row.link_preview.image_url || "",
      }
    : null;

  return {
    id: row.id,
    author: {
      id: row.author_id,
      name: authorName,
      username: row.author?.username || "builder",
      avatar: getAvatarFallback(authorName),
      avatarImage: getLocalAvatar(row.author_id),
    },
    text: row.body,
    image: image?.cdn_url || image?.public_url || "",
    link,
    reactions: reactions || { Fire: row.reactions_count || 0 },
    selectedReaction: dbReactionToUi(row.my_reaction),
    comments,
    createdAt: row.created_at,
    isFollowingAuthor: row.is_following_author,
  };
}

function mapCommentRow(row, isLiked) {
  const name = row.author?.display_name || row.author?.username || "Builder";
  return {
    id: row.id,
    author: name,
    authorId: row.author?.id,
    handle: `@${row.author?.username || "builder"}`,
    avatar: getAvatarFallback(name),
    avatarImage: getLocalAvatar(row.author?.id),
    text: row.body,
    likes: row.likes_count || 0,
    isLiked,
    authorLiked: false,
    replies: [],
    createdAt: row.created_at,
  };
}

function updateAuthUi() {
  const signedIn = Boolean(currentProfile);
  authSignedOut.hidden = signedIn;
  authSignedIn.hidden = !signedIn;
  composer.hidden = !signedIn || activeProfileHandle !== `@${currentProfile?.username}`;

  if (!signedIn) return;
  closeSignupModal();

  const user = profileToUser(currentProfile);
  authName.textContent = user.name;
  authHandle.textContent = user.handle;
  renderAvatarInto(authAvatar, user);
}

function renderAll() {
  renderFeed();
  renderProfile();
  updateAuthUi();
}

function renderFeed() {
  if (feedProfileHandle) {
    renderFeedProfile();
    return;
  }

  postList.hidden = false;
  feedProfileView.hidden = true;
  feedProfileView.innerHTML = "";
  renderPostList(postList, posts, {
    emptyText:
      activeFilter === "following" && !currentProfile
        ? "Sign in to see posts from builders you follow."
        : "No posts here yet.",
  });
}

function renderFeedProfile() {
  const user = getKnownUserByHandle(feedProfileHandle);
  if (!user) {
    feedProfileHandle = null;
    renderFeed();
    return;
  }

  const profilePosts = posts.filter(
    (post) => `@${post.author.username}`.toLowerCase() === user.handle.toLowerCase()
  );
  const isOwnProfile = currentProfile?.id === user.id;
  postList.hidden = true;
  feedProfileView.hidden = false;
  feedProfileView.innerHTML = `
    <header class="profile-card feed-profile-card is-readonly">
      <button class="profile-back-button" type="button" data-feed-profile-back aria-label="Back to feed">
        ${backArrowSvg()}
        <span>Back</span>
      </button>
      <div class="profile-topline">
        <div class="profile-avatar">${renderAvatarContent(user)}</div>
        ${renderFollowButton(user, isOwnProfile)}
      </div>
      <h1>${escapeHtml(user.name)}</h1>
      <p>${escapeHtml(getProfileSummary(user))}</p>
      <div class="profile-stats">
        <span><strong>${user.postCount}</strong> posts</span>
        <span><strong>${user.followersCount}</strong> followers</span>
        <span><strong>${user.followingCount}</strong> following</span>
      </div>
    </header>
    <div class="post-list" data-feed-profile-posts></div>
  `;
  feedProfileView
    .querySelector("[data-feed-profile-back]")
    .addEventListener("click", closeFeedProfile);
  feedProfileView
    .querySelector("[data-follow-profile]")
    ?.addEventListener("click", () => toggleFollow(user.id));
  renderPostList(feedProfileView.querySelector("[data-feed-profile-posts]"), profilePosts);
}

function renderProfile() {
  const fallbackHandle = currentProfile ? `@${currentProfile.username}` : "";
  if (!activeProfileHandle && fallbackHandle) activeProfileHandle = fallbackHandle;
  const user = getKnownUserByHandle(activeProfileHandle) || profileToUser(currentProfile);
  const isOwnProfile = user && currentProfile?.id === user.id;
  const profilePosts = user
    ? posts.filter((post) => `@${post.author.username}`.toLowerCase() === user.handle.toLowerCase())
    : [];

  if (!user) {
    renderAvatarInto(profileAvatar, { avatar: "B" });
    profileTitle.textContent = "Sign in";
    profileBio.textContent = "Create an account to publish build notes and keep a profile.";
    profileStats.innerHTML = `<span><strong>0</strong> posts</span>`;
    composer.hidden = true;
    renderPostList(profilePostList, [], { emptyText: "Sign in to start your Builder Story profile." });
    return;
  }

  renderAvatarInto(profileAvatar, user);
  profileTitle.textContent = user.name;
  profileBio.textContent = getProfileSummary(user);
  profileCard.classList.toggle("is-readonly", !isOwnProfile);
  composer.hidden = !isOwnProfile;
  profileStats.innerHTML = `
    <span><strong>${user.postCount}</strong> posts</span>
    <span><strong>${user.followersCount}</strong> followers</span>
    <span><strong>${user.followingCount}</strong> following</span>
  `;

  renderPostList(profilePostList, profilePosts);
}

function renderPostList(container, list, options = {}) {
  container.innerHTML = "";

  if (isLoading) {
    const loading = document.createElement("div");
    loading.className = "empty-state";
    loading.textContent = "Loading Builder Story...";
    container.append(loading);
    return;
  }

  if (!list.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = options.emptyText || "No posts here yet.";
    container.append(empty);
    return;
  }

  list
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .forEach((post) => container.append(renderPost(post)));
}

function renderPost(post) {
  const template = document.querySelector("#post-template");
  const node = template.content.firstElementChild.cloneNode(true);
  node.dataset.id = post.id;

  const authorHandle = `@${post.author.username}`;
  node.querySelector(".post-avatar").outerHTML = renderProfileTrigger(
    { ...post.author, handle: authorHandle },
    "post-avatar",
    post.author.avatar
  );
  node.querySelector(".post-author").outerHTML = renderProfileTrigger(
    { ...post.author, handle: authorHandle },
    "post-author",
    post.author.name
  );
  node.querySelector(".post-username").innerHTML = ` ${renderUserMention(authorHandle)}`;
  node.querySelector(".post-time").textContent = ` · ${timeAgo(post.createdAt)}`;
  node.querySelector(".post-text").textContent = post.text;

  const image = node.querySelector(".post-image");
  if (isRenderableImageUrl(post.image)) {
    image.src = post.image;
    image.alt = "Post attachment";
    image.loading = "lazy";
    image.decoding = "async";
    image.addEventListener("error", () => {
      image.hidden = true;
      image.removeAttribute("src");
    });
    image.hidden = false;
  }

  const preview = node.querySelector(".link-preview");
  if (post.link) {
    fillPreview(preview, post.link);
    preview.hidden = false;
  }

  renderPostMenu(node, post);
  renderPostActions(node, post);
  return node;
}

function renderPostMenu(node, post) {
  const more = node.querySelector(".post-more");
  const menuWrap = node.querySelector(".post-menu-wrap");
  const menu = node.querySelector(".post-menu");
  const menuButton = node.querySelector(".post-menu-delete");
  const isOwnPost = currentProfile?.id === post.author.id;

  menuButton.textContent = isOwnPost ? "Delete" : "Report";
  menuButton.classList.toggle("post-menu-report", !isOwnPost);
  more.title = "Post actions";
  more.addEventListener("click", () => {
    const isOpen = !menu.hidden;
    closePostMenus();
    menu.hidden = isOpen;
    more.setAttribute("aria-expanded", String(!isOpen));
  });
  menuButton.addEventListener("click", () => {
    if (isOwnPost) {
      deletePost(post.id);
    } else {
      reportPost(post.id);
    }
  });

  if (!currentProfile && post.author.id) {
    menuWrap.remove();
  }
}

function renderPostActions(node, post) {
  const actions = node.querySelector(".post-actions");
  reactionTypes.forEach((type) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = [
      "reaction-button",
      "fire-reaction-button",
      post.selectedReaction === type ? "is-active" : "",
      animatedReactionPostId === post.id && post.selectedReaction === type ? "is-popping" : "",
    ]
      .filter(Boolean)
      .join(" ");
    button.setAttribute("aria-label", "React with fire");
    button.title = "Fire";
    button.innerHTML = `
      <span class="fire-icon" aria-hidden="true">&#128293;</span>
      <span class="fire-count">${post.reactions[type] || 0}</span>
    `;
    button.addEventListener("click", () => toggleReaction(post.id, type));
    actions.append(button);
  });

  const commentsToggle = document.createElement("button");
  const commentsTotal = getCommentsTotal(post);
  commentsToggle.type = "button";
  commentsToggle.className = "comment-toggle";
  commentsToggle.setAttribute("aria-label", `Open comments, ${commentsTotal} comments`);
  commentsToggle.title = "Comments";
  commentsToggle.innerHTML = `
    <svg class="comment-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z"></path>
    </svg>
    <span class="comment-count">${commentsTotal}</span>
  `;
  actions.append(commentsToggle);

  const comments = node.querySelector(".comments");
  const featuredComment = renderFeaturedComment(post);
  if (featuredComment) {
    featuredComment.hidden = openCommentPostIds.has(post.id);
    actions.after(featuredComment);
  }

  renderComments(comments, post);
  comments.classList.toggle("is-open", openCommentPostIds.has(post.id));
  commentsToggle.addEventListener("click", () => {
    const shouldOpen = !comments.classList.contains("is-open");
    comments.classList.toggle("is-open", shouldOpen);
    if (featuredComment) featuredComment.hidden = shouldOpen;
    if (shouldOpen) {
      openCommentPostIds.add(post.id);
    } else {
      openCommentPostIds.delete(post.id);
      if (activeReplyTarget?.postId === post.id) activeReplyTarget = null;
    }
  });
}

function fillPreview(element, link) {
  element.href = link.url;
  const image = element.querySelector(".link-image");
  image.src = link.image || "";
  image.alt = "";
  image.loading = "lazy";
  image.decoding = "async";
  element.querySelector(".link-site").textContent = link.site || getDomain(link.url);
  element.querySelector(".link-title").textContent = link.title || getDomain(link.url);
  element.querySelector(".link-desc").textContent =
    link.desc || "Preview is unavailable. Open the original source.";
  element.querySelector(".link-url").textContent = getDomain(link.url);
}

function getCommentsTotal(post) {
  return post.comments.reduce((total, comment) => total + 1 + comment.replies.length, 0);
}

function getKnownUserByHandle(handle) {
  const key = String(handle || "").toLowerCase();
  if (knownProfiles.has(key)) return knownProfiles.get(key);

  for (const post of posts) {
    const postHandle = `@${post.author.username}`.toLowerCase();
    if (postHandle === key) {
      return {
        id: post.author.id,
        name: post.author.name,
        username: post.author.username,
        handle: `@${post.author.username}`,
        avatar: post.author.avatar,
        avatarImage: post.author.avatarImage || getLocalAvatar(post.author.id),
        postCount: posts.filter((item) => item.author.id === post.author.id).length,
        followersCount: 0,
        followingCount: 0,
        isFollowing: followingIds.has(post.author.id),
      };
    }
  }
  return null;
}

function renderUserMention(handle) {
  const user = getKnownUserByHandle(handle);
  if (!user) return escapeHtml(handle);
  return `<button class="user-mention" type="button" data-user-handle="${escapeHtml(
    user.handle
  )}" aria-label="Open profile ${escapeHtml(user.handle)}">${escapeHtml(user.handle)}</button>`;
}

function renderProfileTrigger(userLike, className, label) {
  const user = getKnownUserByHandle(userLike.handle) || {
    id: userLike.id || userLike.authorId,
    handle: userLike.handle || makeCommentHandle(userLike.author || userLike.name),
    name: userLike.author || userLike.name || "Builder",
    avatar: userLike.avatar || "?",
    avatarImage: userLike.avatarImage || getLocalAvatar(userLike.id || userLike.authorId),
  };
  const isAvatar = className.includes("avatar");
  const content = isAvatar ? renderAvatarContent(user) : escapeHtml(label ?? user.name);
  return `<button class="${className} profile-trigger" type="button" data-user-handle="${escapeHtml(
    user.handle
  )}" aria-label="Open mini profile ${escapeHtml(user.name)}">${content}</button>`;
}

function renderRichText(value) {
  const text = String(value || "");
  const mentionPattern = /@([a-z0-9_]+)/gi;
  let result = "";
  let lastIndex = 0;
  let match;

  while ((match = mentionPattern.exec(text))) {
    const handle = match[0].toLowerCase();
    result += escapeHtml(text.slice(lastIndex, match.index));
    result += getKnownUserByHandle(handle) ? renderUserMention(handle) : escapeHtml(match[0]);
    lastIndex = match.index + match[0].length;
  }

  result += escapeHtml(text.slice(lastIndex));
  return result;
}

function renderFeaturedComment(post) {
  const comment = getFeaturedComment(post);
  if (!comment) return null;

  const preview = document.createElement("article");
  preview.className = "featured-comment";
  preview.tabIndex = 0;
  preview.setAttribute("role", "button");
  preview.setAttribute("aria-label", `Open featured comment by ${comment.author}`);
  preview.innerHTML = `
    ${renderProfileTrigger(comment, "comment-avatar", comment.avatar)}
    <span class="featured-comment-body">
      <span class="featured-comment-head">
        ${renderProfileTrigger(comment, "featured-comment-author", comment.author)}
        <span>${escapeHtml(getCommentTime(comment))}</span>
      </span>
      <span class="featured-comment-text">${renderRichText(comment.text)}</span>
      <span class="featured-comment-actions">
        <button class="comment-action comment-like ${comment.isLiked ? "is-active" : ""}" type="button" aria-label="Like comment">
          ${heartIconSvg()}
          <span>${comment.likes || ""}</span>
        </button>
      </span>
    </span>
  `;
  preview.addEventListener("click", (event) => {
    if (event.target.closest(".comment-like, .user-mention, .profile-trigger")) return;
    openCommentPostIds.add(post.id);
    renderAll();
  });
  preview.addEventListener("keydown", (event) => {
    if (event.target !== preview) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openCommentPostIds.add(post.id);
    renderAll();
  });
  preview.querySelector(".comment-like").addEventListener("click", (event) => {
    event.stopPropagation();
    toggleCommentLike(comment.id, false);
  });
  return preview;
}

function getFeaturedComment(post) {
  if (!post.comments.length) return null;
  const topLikes = Math.max(...post.comments.map((comment) => comment.likes || 0));
  const best = post.comments.filter((comment) => (comment.likes || 0) === topLikes);
  return pickStableRandom(best, post.id);
}

function pickStableRandom(items, salt) {
  if (items.length <= 1) return items[0] || null;
  const seed = items.reduce((value, item) => value + hashString(`${salt}:${item.id}`), 0);
  return items[seed % items.length];
}

function hashString(value) {
  return String(value).split("").reduce((hash, char) => {
    return (hash * 31 + char.charCodeAt(0)) >>> 0;
  }, 17);
}

function makeCommentHandle(author) {
  return `@${String(author || "builder")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 16)}`;
}

function renderComments(container, post) {
  container.innerHTML = "";

  post.comments.forEach((comment) => {
    container.append(renderCommentThread(post, comment));
  });

  const form = document.createElement("form");
  form.className = "comment-form";
  form.innerHTML = `
    <input type="text" maxlength="160" placeholder="Add a comment..." required />
    <button type="submit" aria-label="Send comment" title="Send">${sendIconSvg()}</button>
  `;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = form.querySelector("input");
    addComment(post.id, input.value.trim());
  });
  container.append(form);
}

function renderCommentThread(post, comment) {
  const thread = document.createElement("article");
  thread.className = "comment-thread";
  thread.innerHTML = `
    <div class="comment">
      ${renderProfileTrigger(comment, "comment-avatar", comment.avatar)}
      <div class="comment-body">
        <div class="comment-head">
          ${renderProfileTrigger(comment, "comment-author", comment.author)}
          <small>${escapeHtml(getCommentTime(comment))}</small>
        </div>
        <p>${renderRichText(comment.text)}</p>
        <div class="comment-actions">
          <button class="comment-action comment-like ${comment.isLiked ? "is-active" : ""}" type="button" aria-label="Like comment">
            ${heartIconSvg()}
            <span>${comment.likes || ""}</span>
          </button>
          <button class="comment-action comment-reply-button" type="button" aria-label="Reply to comment" title="Reply">
            ${replyArrowSvg()}
          </button>
        </div>
      </div>
    </div>
  `;

  thread.querySelector(".comment-like").addEventListener("click", () => {
    toggleCommentLike(comment.id);
  });
  thread.querySelector(".comment-reply-button").addEventListener("click", () => {
    activeReplyTarget = { postId: post.id, commentId: comment.id };
    openCommentPostIds.add(post.id);
    renderAll();
  });

  const replies = document.createElement("div");
  replies.className = "comment-replies";
  comment.replies.forEach((reply) => {
    replies.append(renderReplyComment(post, comment, reply));
  });

  if (activeReplyTarget?.postId === post.id && activeReplyTarget.commentId === comment.id) {
    replies.append(renderReplyForm(post, comment));
  }

  if (replies.children.length) thread.append(replies);
  return thread;
}

function renderReplyComment(post, parentComment, reply) {
  const row = document.createElement("div");
  row.className = "comment comment-reply";
  row.innerHTML = `
    ${renderProfileTrigger(reply, "comment-avatar", reply.avatar)}
    <div class="comment-body">
      <div class="comment-head">
        ${renderProfileTrigger(reply, "comment-author", reply.author)}
        <small>${escapeHtml(getCommentTime(reply))}</small>
      </div>
      <p>${renderRichText(reply.text)}</p>
      <div class="comment-actions">
        <button class="comment-action comment-like ${reply.isLiked ? "is-active" : ""}" type="button" aria-label="Like reply">
          ${heartIconSvg()}
          <span>${reply.likes || ""}</span>
        </button>
        <button class="comment-action comment-reply-button" type="button" aria-label="Reply to comment" title="Reply">
          ${replyArrowSvg()}
        </button>
      </div>
    </div>
  `;

  row.querySelector(".comment-like").addEventListener("click", () => {
    toggleCommentLike(reply.id);
  });
  row.querySelector(".comment-reply-button").addEventListener("click", () => {
    activeReplyTarget = { postId: post.id, commentId: parentComment.id, mention: reply.handle };
    openCommentPostIds.add(post.id);
    renderAll();
  });
  return row;
}

function renderReplyForm(post, comment) {
  const form = document.createElement("form");
  form.className = "comment-form comment-reply-form";
  const replyMention =
    activeReplyTarget?.postId === post.id && activeReplyTarget.commentId === comment.id
      ? activeReplyTarget.mention
      : "";
  form.innerHTML = `
    <input type="text" maxlength="160" placeholder="Reply to ${escapeHtml(replyMention || comment.author)}..." required />
    <button type="submit" aria-label="Send reply" title="Send reply">${sendIconSvg()}</button>
  `;
  requestAnimationFrame(() => {
    form.querySelector("input")?.focus();
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = form.querySelector("input");
    const rawText = input.value.trim();
    const text = replyMention ? `${replyMention} ${rawText}` : rawText;
    addComment(post.id, text, comment.id);
  });
  return form;
}

async function createPost() {
  if (!requireProfile()) return;
  const text = textInput.value.trim();
  const externalUrl = externalUrlInput.value.trim();
  const link = makeLinkPreview(externalUrl);
  const image = getImageAttachment();

  if (!text) return;

  const { data: post, error } = await supabaseClient
    .from("posts")
    .insert({
      author_id: currentProfile.id,
      body: text,
      post_type: link ? "link_repost" : "build_note",
    })
    .select("id")
    .single();

  if (error) {
    setStatus(error.message);
    return;
  }

  if (link) {
    const { error: linkError } = await supabaseClient.from("link_previews").insert({
      post_id: post.id,
      original_url: externalUrl,
      normalized_url: link.url,
      domain: getDomain(link.url),
      site_name: link.site,
      title: link.title,
      description: link.desc,
      image_url: link.image,
      fetch_status: "fallback",
      fetched_at: new Date().toISOString(),
    });
    if (linkError) setStatus(linkError.message);
  }

  if (image) {
    setStatus("Post published. Image upload needs Cloudflare R2 wiring next.");
  } else {
    setStatus("");
  }

  composer.reset();
  clearImagePreview();
  composerPreview.hidden = true;
  composerPreview.innerHTML = "";
  await loadAppData({ showLoading: false });
}

async function deletePost(postId) {
  if (!requireProfile()) return;
  const confirmed = confirm("Delete this post?");
  if (!confirmed) return;

  const { error } = await supabaseClient
    .from("posts")
    .update({ status: "deleted", deleted_at: new Date().toISOString() })
    .eq("id", postId);

  if (error) {
    setStatus(error.message);
    return;
  }
  await loadAppData({ showLoading: false });
}

async function reportPost(postId) {
  if (!requireProfile()) return;
  const reason = prompt("Why are you reporting this post?", "Spam or unsafe content");
  if (!reason?.trim()) return;

  const { error } = await supabaseClient.from("reports").insert({
    reporter_id: currentProfile.id,
    target_type: "post",
    post_id: postId,
    reason: reason.trim(),
  });

  setStatus(error ? error.message : "Report submitted.");
}

async function toggleReaction(postId, type) {
  if (!requireProfile()) return;
  const post = posts.find((item) => item.id === postId);
  if (!post) return;

  const dbType = uiReactionToDb(type);
  let error;
  if (post.selectedReaction === type) {
    ({ error } = await supabaseClient
      .from("post_reactions")
      .delete()
      .eq("post_id", postId)
      .eq("user_id", currentProfile.id));
  } else {
    ({ error } = await supabaseClient.from("post_reactions").upsert(
      {
        post_id: postId,
        user_id: currentProfile.id,
        reaction_type: dbType,
      },
      { onConflict: "post_id,user_id" }
    ));
  }

  if (error) {
    setStatus(error.message);
    return;
  }

  animatedReactionPostId = postId;
  await loadAppData({ showLoading: false });
  animatedReactionPostId = null;
}

async function addComment(postId, text, parentCommentId = null) {
  if (!requireProfile()) return;
  if (!text) return;

  const { error } = await supabaseClient.from("comments").insert({
    post_id: postId,
    author_id: currentProfile.id,
    parent_comment_id: parentCommentId,
    body: text,
  });

  if (error) {
    setStatus(error.message);
    return;
  }

  activeReplyTarget = null;
  openCommentPostIds.add(postId);
  await loadAppData({ showLoading: false });
}

async function toggleCommentLike(commentId, shouldOpenComments = true) {
  if (!requireProfile()) return;
  const comment = findCommentById(posts.flatMap((post) => post.comments), commentId);
  if (!comment) return;

  const query = supabaseClient
    .from("comment_likes")
    .delete()
    .eq("comment_id", commentId)
    .eq("user_id", currentProfile.id);

  const { error } = comment.isLiked
    ? await query
    : await supabaseClient.from("comment_likes").insert({
        comment_id: commentId,
        user_id: currentProfile.id,
      });

  if (error) {
    setStatus(error.message);
    return;
  }

  if (shouldOpenComments) {
    const post = posts.find((item) => findCommentById(item.comments, commentId));
    if (post) openCommentPostIds.add(post.id);
  }
  await loadAppData({ showLoading: false });
}

function findCommentById(comments, commentId) {
  for (const comment of comments) {
    if (comment.id === commentId) return comment;
    const reply = comment.replies.find((item) => item.id === commentId);
    if (reply) return reply;
  }
  return null;
}

async function toggleFollow(profileId) {
  if (!requireProfile()) return;
  if (profileId === currentProfile.id) return;

  const isFollowing = followingIds.has(profileId);
  const { error } = isFollowing
    ? await supabaseClient
        .from("follows")
        .delete()
        .eq("follower_id", currentProfile.id)
        .eq("following_id", profileId)
    : await supabaseClient.from("follows").insert({
        follower_id: currentProfile.id,
        following_id: profileId,
      });

  if (error) {
    setStatus(error.message);
    return;
  }

  await loadAppData({ showLoading: false });
}

function requireProfile() {
  if (currentProfile) return true;
  openSignupModal();
  return false;
}

function getCommentTime(comment) {
  return comment.createdAt ? timeAgo(comment.createdAt) : "now";
}

function renderFollowButton(user, isOwnProfile) {
  if (isOwnProfile || !currentProfile) return "";
  return `<button class="profile-link" type="button" data-follow-profile="${escapeHtml(user.id)}">${
    followingIds.has(user.id) ? "Following" : "Follow"
  }</button>`;
}

function openProfilePopover(handle, anchor) {
  const user = getKnownUserByHandle(handle);
  if (!user) return;

  closeProfilePopover();

  const popover = document.createElement("aside");
  popover.className = "profile-popover";
  popover.setAttribute("role", "dialog");
  popover.setAttribute("aria-label", `Mini profile for ${user.name}`);
  popover.innerHTML = `
    <div class="profile-popover-art"></div>
    <div class="profile-popover-main">
      <button class="profile-popover-avatar" type="button" data-open-profile="${escapeHtml(user.handle)}" aria-label="Open ${escapeHtml(user.name)} profile">${renderAvatarContent(user)}</button>
      <div class="profile-popover-copy">
        <button class="profile-popover-name" type="button" data-open-profile="${escapeHtml(user.handle)}">${escapeHtml(user.name)}</button>
        <span>${escapeHtml(user.handle)}</span>
      </div>
    </div>
    <p>${escapeHtml(getProfileSummary(user))}</p>
    <div class="profile-popover-stats">
      <span><strong>${user.postCount}</strong> posts</span>
      <span><strong>${user.followersCount}</strong> followers</span>
    </div>
  `;

  document.body.append(popover);
  activeProfilePopover = popover;
  popover.querySelectorAll("[data-open-profile]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      openUserProfile(button.dataset.openProfile);
    });
  });
  positionProfilePopover(popover, anchor);
}

function closeProfilePopover() {
  activeProfilePopover?.remove();
  activeProfilePopover = null;
}

function positionProfilePopover(popover, anchor) {
  const rect = anchor.getBoundingClientRect();
  const margin = 12;
  const width = popover.offsetWidth;
  const height = popover.offsetHeight;
  const left = Math.min(
    window.innerWidth - width - margin,
    Math.max(margin, rect.left + rect.width / 2 - width / 2)
  );
  const preferredTop = rect.bottom + 8;
  const top =
    preferredTop + height + margin > window.innerHeight
      ? Math.max(margin, rect.top - height - 8)
      : preferredTop;

  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
  popover.dataset.fixedLeft = String(left);
  popover.dataset.fixedTop = String(top);
}

function lockProfilePopoverPosition() {
  if (!activeProfilePopover) return;
  activeProfilePopover.style.left = `${activeProfilePopover.dataset.fixedLeft}px`;
  activeProfilePopover.style.top = `${activeProfilePopover.dataset.fixedTop}px`;
}

function getProfileSummary(user) {
  if (user.bio) return user.bio;
  if (user.postCount && user.followersCount) return "Building and discussing projects on Builder Story.";
  if (user.postCount) return "Sharing build updates on Builder Story.";
  return "Builder Story member.";
}

function openUserProfile(handle) {
  const user = getKnownUserByHandle(handle);
  if (!user) return;

  feedProfileHandle = user.handle;
  closeProfilePopover();
  closeMobileMenu();
  switchView("feed");
  renderFeed();
}

function closeFeedProfile() {
  feedProfileHandle = null;
  renderFeed();
}

function heartIconSvg() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z"></path>
    </svg>
  `;
}

function replyArrowSvg() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M9 7 4 12l5 5"></path>
      <path d="M4 12h11a5 5 0 0 1 5 5v1"></path>
    </svg>
  `;
}

function backArrowSvg() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m15 18-6-6 6-6"></path>
    </svg>
  `;
}

function sendIconSvg() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M22 2 11 13"></path>
      <path d="m22 2-7 20-4-9-9-4 20-7Z"></path>
    </svg>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function closePostMenus() {
  document.querySelectorAll(".post-menu").forEach((menu) => {
    menu.hidden = true;
  });
  document.querySelectorAll(".post-more").forEach((button) => {
    button.setAttribute("aria-expanded", "false");
  });
}

function switchView(viewName) {
  activeView = viewName;
  document
    .querySelectorAll("[data-view]")
    .forEach((item) => item.classList.toggle("is-active", item.dataset.view === viewName));
  document
    .querySelectorAll(".view")
    .forEach((view) => view.classList.toggle("is-active", view.id === `${viewName}-view`));
}

function closeMobileMenu() {
  rail.classList.remove("is-open");
  mobileMenuButton.setAttribute("aria-expanded", "false");
}

function setMobileMenuVisibility(value) {
  mobileMenuVisibility = Math.min(1, Math.max(0, value));
  mobileMenuButton.style.setProperty(
    "--mobile-menu-visibility",
    mobileMenuVisibility.toFixed(3)
  );
  mobileMenuButton.classList.toggle("is-hidden-by-scroll", mobileMenuVisibility <= 0.04);
}

function handleMobileMenuScroll() {
  const currentScrollY = Math.max(0, window.scrollY);
  const delta = currentScrollY - lastScrollY;
  lastScrollY = currentScrollY;

  if (rail.classList.contains("is-open") || currentScrollY === 0) {
    setMobileMenuVisibility(1);
    return;
  }

  if (delta > 0) {
    setMobileMenuVisibility(mobileMenuVisibility - delta / MOBILE_MENU_HIDE_DISTANCE);
  } else if (delta < 0) {
    setMobileMenuVisibility(1);
  }
}

function toggleMobileMenu() {
  const isOpen = rail.classList.toggle("is-open");
  mobileMenuButton.setAttribute("aria-expanded", String(isOpen));
  if (isOpen) setMobileMenuVisibility(1);
}

function clearImagePreview() {
  imageReadToken += 1;
  imageFileInput.value = "";
  imageFilePreview = "";
  imagePreview.hidden = true;
  imagePreview.innerHTML = "";
}

function setSignupError(message) {
  if (signupError) signupError.textContent = message || "";
}

function getSignupDisplayName() {
  return normalizeDisplayName(signupNameInput?.value || "");
}

function getSignupUsername() {
  return normalizeUsername(getSignupDisplayName());
}

function updateSignupPreview() {
  const displayName = getSignupDisplayName();
  const username = normalizeUsername(displayName || "builder");
  if (signupHandlePreview) signupHandlePreview.textContent = `@${username || "builder"}`;
  renderAvatarInto(signupAvatarPreview, {
    name: displayName || "Builder",
    avatar: getAvatarFallback(displayName || "Builder"),
    avatarImage: signupAvatarDataUrl,
  });
}

function openSignupModal(message = "") {
  if (!signupModal) return;

  const pending = readJsonStorage(ONBOARDING_STORAGE_KEY);
  if (pending?.displayName && signupNameInput && !signupNameInput.value.trim()) {
    signupNameInput.value = pending.displayName;
  }
  if (pending?.avatarDataUrl && !signupAvatarDataUrl) {
    signupAvatarDataUrl = pending.avatarDataUrl;
  }

  setSignupError(message);
  updateSignupPreview();
  signupModal.hidden = false;
  closeMobileMenu();
  requestAnimationFrame(() => signupNameInput?.focus());
}

function closeSignupModal() {
  if (signupModal) signupModal.hidden = true;
}

async function resizeAvatarFile(file) {
  if (!file?.type?.startsWith("image/")) {
    setSignupError("Choose an image file.");
    return "";
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    const loaded = new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
    });
    image.src = objectUrl;
    await loaded;

    const size = 256;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    const sourceSize = Math.min(image.naturalWidth, image.naturalHeight);
    const sourceX = Math.max(0, (image.naturalWidth - sourceSize) / 2);
    const sourceY = Math.max(0, (image.naturalHeight - sourceSize) / 2);
    context.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, size, size);
    return canvas.toDataURL("image/jpeg", 0.84);
  } catch {
    setSignupError("Avatar could not be loaded.");
    return "";
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function prepareOnboarding() {
  const displayName = getSignupDisplayName();
  const username = getSignupUsername();

  if (!displayName) {
    setSignupError("Enter your name.");
    return null;
  }

  if (username.length < 3) {
    setSignupError("Use at least 3 letters or numbers.");
    return null;
  }

  const { data, error } = await supabaseClient
    .from("profiles")
    .select("id")
    .eq("username", username)
    .maybeSingle();

  if (error) {
    setSignupError(error.message);
    return null;
  }

  if (data && data.id !== currentProfile?.id) {
    setSignupError(`@${username} is already taken.`);
    return null;
  }

  const pending = {
    displayName,
    username,
    avatarDataUrl: signupAvatarDataUrl,
  };
  writeJsonStorage(ONBOARDING_STORAGE_KEY, pending);
  return pending;
}

async function signInWithGoogle() {
  if (!supabaseClient) {
    setStatus("Supabase SDK did not load.");
    return;
  }

  if (currentProfile) return;

  if (signupModal?.hidden) {
    openSignupModal();
    return;
  }

  const pending = await prepareOnboarding();
  if (!pending) return;

  setStatus("Opening Google...");
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${window.location.origin}${window.location.pathname}`,
      queryParams: {
        prompt: "select_account",
      },
    },
  });

  if (error) {
    setStatus(error.message);
    return;
  }
}

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.dataset.view === "feed") feedProfileHandle = null;
    if (button.dataset.view === "profile" && currentProfile) {
      activeProfileHandle = `@${currentProfile.username}`;
    }
    switchView(button.dataset.view);
    renderAll();
    closeMobileMenu();
  });
});

openSignupButtons.forEach((button) => {
  button.addEventListener("click", () => openSignupModal());
});

googleSigninButton?.addEventListener("click", signInWithGoogle);
authSignout.addEventListener("click", async () => {
  await supabaseClient.auth.signOut();
});

mobileMenuButton.addEventListener("click", toggleMobileMenu);
window.addEventListener("scroll", handleMobileMenuScroll, { passive: true });
window.addEventListener("scroll", lockProfilePopoverPosition, { passive: true });

document.querySelectorAll("[data-feed-filter]").forEach((button) => {
  button.addEventListener("click", async () => {
    activeFilter = button.dataset.feedFilter;
    feedProfileHandle = null;
    document
      .querySelectorAll("[data-feed-filter]")
      .forEach((item) => item.classList.toggle("is-active", item === button));
    await loadAppData();
  });
});

document.addEventListener("click", (event) => {
  const profileTrigger = event.target.closest(".user-mention, .profile-trigger");
  if (profileTrigger) {
    event.preventDefault();
    event.stopPropagation();
    openProfilePopover(profileTrigger.dataset.userHandle, profileTrigger);
    closePostMenus();
    return;
  }

  if (event.target.closest(".profile-popover")) return;
  closeProfilePopover();

  if (event.target.closest(".post-menu-wrap")) return;
  closePostMenus();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeProfilePopover();
    closeSignupModal();
  }
});

signupCloseTargets.forEach((target) => {
  target.addEventListener("click", closeSignupModal);
});

signupNameInput?.addEventListener("input", () => {
  setSignupError("");
  updateSignupPreview();
});

signupAvatarInput?.addEventListener("change", async () => {
  const file = signupAvatarInput.files?.[0];
  if (!file) return;

  const resized = await resizeAvatarFile(file);
  if (!resized) return;

  signupAvatarDataUrl = resized;
  setSignupError("");
  updateSignupPreview();
});

document.querySelector("[data-attach-image]").addEventListener("click", () => {
  imageFileInput.click();
});

imageFileInput.addEventListener("change", () => {
  const file = imageFileInput.files?.[0];
  imageReadToken += 1;
  const currentToken = imageReadToken;

  if (!file) {
    clearImagePreview();
    return;
  }

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    if (currentToken !== imageReadToken) return;

    const result = String(reader.result || "");
    imageFilePreview = isRenderableImageUrl(result) ? result : "";
    if (!imageFilePreview) return;

    imagePreview.hidden = false;
    imagePreview.innerHTML = `
      <button class="image-chip" type="button" data-clear-image>
        <img src="${imageFilePreview}" alt="" />
        <span>${escapeHtml(file.name)}</span>
        <strong aria-hidden="true">x</strong>
      </button>
    `;
  });
  reader.readAsDataURL(file);
});

imagePreview.addEventListener("click", (event) => {
  if (!event.target.closest("[data-clear-image]")) return;
  clearImagePreview();
});

externalUrlInput.addEventListener("input", () => {
  const link = makeLinkPreview(externalUrlInput.value.trim());
  if (!link) {
    composerPreview.hidden = true;
    composerPreview.innerHTML = "";
    return;
  }

  composerPreview.hidden = false;
  composerPreview.innerHTML = `
    <a class="link-preview" href="${escapeHtml(link.url)}" target="_blank" rel="noreferrer">
      <img class="link-image" src="${escapeHtml(link.image)}" alt="" />
      <span class="link-content">
        <span class="link-site">${escapeHtml(link.site)}</span>
        <strong class="link-title">${escapeHtml(link.title)}</strong>
        <span class="link-desc">${escapeHtml(link.desc)}</span>
        <span class="link-url">${escapeHtml(getDomain(link.url))}</span>
      </span>
    </a>
  `;
});

composer.addEventListener("submit", async (event) => {
  event.preventDefault();
  await createPost();
});

initializeApp();
