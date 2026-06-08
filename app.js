const SUPABASE_URL = "https://xrwzgtzdtkvgjrkzeztn.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_UYKQPoCWBdRCWLfwJBCdsw_jMF1mMpt";
const MEDIA_UPLOAD_ENDPOINT = "https://builder-story-media-api.salahovrafis15.workers.dev";
const MEDIA_PUBLIC_BASE_URL = "https://pub-470c44e3668947c3be8cfa30672936d5.r2.dev";
const MAX_MEDIA_FILES_PER_POST = 4;
const MAX_MEDIA_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MEDIA_EXTENSION_TYPES = new Map([
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
  ["gif", "image/gif"],
]);
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
let selectedPostMediaFiles = [];
let imageReadToken = 0;
let lastScrollY = window.scrollY;
let lastSearchScrollY = window.scrollY;
let mobileMenuVisibility = 1;
let animatedReactionPostId = null;
let activeReplyTarget = null;
let activeProfilePopover = null;
let activeProfilePopoverPosition = null;
let activeProfileHandle = "";
let feedProfileHandle = null;
let isLoading = true;
let isPublishingPost = false;
const openCommentPostIds = new Set();
const pendingReactionPostIds = new Set();

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
const avatarFileInput = document.querySelector("#avatar-file");
const externalUrlInput = document.querySelector("#external-url");
const imagePreview = document.querySelector("#image-preview");
const composerPreview = document.querySelector("#composer-preview");
const rail = document.querySelector(".rail");
const mobileMenuButton = document.querySelector("[data-mobile-menu]");
const googleSigninButton = document.querySelector("[data-google-signin]");
const authStatus = document.querySelector("[data-auth-status]");
const authSignedOut = document.querySelector("[data-auth-signed-out]");
const authSignedIn = document.querySelector("[data-auth-signed-in]");
const authName = document.querySelector("[data-auth-name]");
const authHandle = document.querySelector("[data-auth-handle]");
const authAvatar = document.querySelector("[data-auth-avatar]");
const authSignout = document.querySelector("[data-auth-signout]");
const themeToggle = document.querySelector("[data-theme-toggle]");
const newPostButton = document.querySelector("[data-new-post]");
const settingsButton = document.querySelector("[data-settings-button]");
const topSearch = document.querySelector(".top-search");
const authPrompt = document.querySelector("[data-auth-prompt]");
const authPromptCopy = document.querySelector("[data-auth-prompt-copy]");
const authPromptClose = document.querySelector("[data-auth-prompt-close]");
const authPromptSignin = document.querySelector("[data-auth-prompt-signin]");
const profilePopoverLayer = document.querySelector("[data-profile-popover-layer]");
const MOBILE_MENU_HIDE_DISTANCE = 220;

function setStatus(message) {
  if (authStatus) authStatus.textContent = message || "";
}

function getStoredTheme() {
  try {
    return localStorage.getItem("builder-story-theme");
  } catch {
    return "";
  }
}

function storeTheme(theme) {
  try {
    localStorage.setItem("builder-story-theme", theme);
  } catch {
    // localStorage can be blocked in some embedded previews.
  }
}

function setTheme(theme) {
  const isDark = theme === "dark";
  document.body.classList.toggle("theme-dark", isDark);
  themeToggle?.setAttribute("aria-pressed", String(isDark));
  storeTheme(isDark ? "dark" : "light");
}

function initializeTheme() {
  const stored = getStoredTheme();
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)")?.matches;
  setTheme(stored || (prefersDark ? "dark" : "light"));
}

function showAuthPrompt(copy) {
  if (!authPrompt) return;
  if (authPromptCopy && copy) authPromptCopy.textContent = copy;
  authPrompt.hidden = false;
  authPromptSignin?.focus();
}

function closeAuthPrompt() {
  if (authPrompt) authPrompt.hidden = true;
}

function getProfileRouteHandle() {
  const params = new URLSearchParams(window.location.search);
  const handle = params.get("handle");
  return handle ? `@${normalizeUsername(handle)}` : "";
}

function writeRouteForView(viewName, mode = "push") {
  const url = new URL(window.location.href);
  if (viewName === "profile") {
    url.searchParams.set("view", "profile");
    const handle = activeProfileHandle || (currentProfile ? `@${currentProfile.username}` : "");
    if (handle) url.searchParams.set("handle", handle.replace(/^@/, ""));
  } else {
    url.searchParams.delete("view");
    url.searchParams.delete("handle");
  }

  const next = `${url.pathname}${url.search}${url.hash}`;
  if (next === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;
  history[mode === "replace" ? "replaceState" : "pushState"]({ view: viewName }, "", next);
}

function applyRouteFromLocation() {
  const params = new URLSearchParams(window.location.search);
  const routeView = params.get("view");
  if (routeView === "profile") {
    feedProfileHandle = null;
    activeProfileHandle = getProfileRouteHandle() || activeProfileHandle || (currentProfile ? `@${currentProfile.username}` : "");
    switchView("profile");
    return;
  }

  feedProfileHandle = null;
  switchView("feed");
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

function profileToUser(profile) {
  if (!profile) return null;
  const name = profile.display_name || profile.username || "Builder";
  const avatarMedia = Array.isArray(profile.avatar_media)
    ? profile.avatar_media[0]
    : profile.avatar_media;
  return {
    id: profile.id,
    name,
    username: profile.username,
    handle: `@${profile.username}`,
    avatar: name.slice(0, 1).toUpperCase(),
    avatarUrl: avatarMedia?.cdn_url || avatarMedia?.public_url || "",
    avatarObjectKey: avatarMedia?.object_key || "",
    avatarMediaId: profile.avatar_media_id || avatarMedia?.id || "",
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

function normalizeMediaItem(item) {
  const publicUrl = item?.public_url || item?.cdn_url || item?.url || "";
  return {
    id: item?.id || item?.object_key || publicUrl,
    url: publicUrl,
    objectKey: item?.object_key || "",
    contentType: item?.content_type || item?.mime_type || "",
    sizeBytes: item?.size_bytes || item?.byte_size || 0,
    sortOrder: item?.sort_order || item?.position || 0,
  };
}

function getMediaPublicUrl(key) {
  const cleanBase = MEDIA_PUBLIC_BASE_URL.replace(/\/$/, "");
  return key ? `${cleanBase}/${key}` : "";
}

function validateImageFile(file) {
  const contentType = getImageContentType(file);
  if (!ALLOWED_MEDIA_TYPES.has(contentType)) {
    return "Only JPEG, PNG, WebP, and GIF images are supported.";
  }
  if (file.size > MAX_MEDIA_FILE_BYTES) {
    return "Images must be 10 MB or smaller.";
  }
  return "";
}

function getFileExtension(file) {
  const name = String(file?.name || "");
  const extension = name.includes(".") ? name.split(".").pop().toLowerCase() : "";
  return extension || "";
}

function getImageContentType(file) {
  const rawType = String(file?.type || "").toLowerCase();
  if (rawType === "image/jpg") return "image/jpeg";
  if (ALLOWED_MEDIA_TYPES.has(rawType)) return rawType;
  return MEDIA_EXTENSION_TYPES.get(getFileExtension(file)) || rawType;
}

function normalizeImageFile(file) {
  const contentType = getImageContentType(file);
  if (!ALLOWED_MEDIA_TYPES.has(contentType) || file.type === contentType) return file;
  return new File([file], file.name || `image.${contentType.split("/")[1]}`, {
    type: contentType,
    lastModified: file.lastModified || Date.now(),
  });
}

function renderAvatarVisual(user, className = "avatar-image") {
  if (isRenderableImageUrl(user?.avatarUrl)) {
    return `<img class="${className}" src="${escapeHtml(user.avatarUrl)}" alt="" loading="lazy" decoding="async" />`;
  }
  return escapeHtml(user?.avatar || "?");
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
  if (!currentSession?.user) {
    currentProfile = null;
    return;
  }
  if (currentProfile && currentProfile.id !== currentSession.user.id) {
    currentProfile = null;
  }

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

  currentProfile = null;

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

async function loadAppData({ showLoading = true } = {}) {
  if (showLoading) {
    isLoading = true;
    renderAll();
  }

  await ensureCurrentProfile();
  await loadFollowing();
  await loadProfiles();
  await loadPosts();

  updateAuthUi();
  isLoading = false;
  const restoreScroll = showLoading ? null : { left: window.scrollX, top: window.scrollY };
  applyRouteFromLocation();
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
    .select("id, username, display_name, bio, headline, avatar_media_id, posts_count, followers_count, following_count, avatar_media:media_assets!profiles_avatar_media_id_fkey(id, object_key, public_url, cdn_url)");

  if (error) {
    setStatus(error.message);
    return;
  }

  (data || []).forEach((profile) => {
    knownProfiles.set(`@${profile.username}`.toLowerCase(), profileToUser(profile));
  });
}

async function loadPosts() {
  if (activeFilter === "following" && !currentProfile) {
    posts = [];
    return;
  }

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
      "id, post_id, parent_comment_id, body, likes_count, created_at, author:profiles!comments_author_id_fkey(id, username, display_name, bio, headline, avatar_media_id, posts_count, followers_count, following_count)"
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
  const rowMedia = Array.isArray(row.media) ? row.media.map(normalizeMediaItem) : [];
  const media = rowMedia;
  const image = media.find((item) => isRenderableImageUrl(item.url));
  const authorHandle = `@${row.author?.username || "builder"}`.toLowerCase();
  const knownAuthor = knownProfiles.get(authorHandle);
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
      avatar: authorName.slice(0, 1).toUpperCase(),
      avatarUrl: knownAuthor?.avatarUrl || "",
    },
    text: row.body,
    image: image?.url || "",
    images: media.filter((item) => isRenderableImageUrl(item.url)),
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
  const handle = `@${row.author?.username || "builder"}`;
  const knownAuthor = knownProfiles.get(handle.toLowerCase());
  return {
    id: row.id,
    author: name,
    authorId: row.author?.id,
    handle,
    avatar: name.slice(0, 1).toUpperCase(),
    avatarUrl: knownAuthor?.avatarUrl || "",
    text: row.body,
    likes: row.likes_count || 0,
    isLiked,
    authorLiked: false,
    replies: [],
    createdAt: row.created_at,
  };
}

function applyOptimisticReaction(post, type) {
  const previousReaction = post.selectedReaction;
  post.reactions = { ...post.reactions };

  if (previousReaction === type) {
    post.selectedReaction = null;
    post.reactions[type] = Math.max(0, (post.reactions[type] || 0) - 1);
    return;
  }

  if (previousReaction) {
    post.reactions[previousReaction] = Math.max(0, (post.reactions[previousReaction] || 0) - 1);
  }
  post.selectedReaction = type;
  post.reactions[type] = (post.reactions[type] || 0) + 1;
}

function restoreReaction(post, snapshot) {
  post.selectedReaction = snapshot.selectedReaction;
  post.reactions = { ...snapshot.reactions };
}

function updateAuthUi() {
  const signedIn = Boolean(currentProfile);
  authSignedOut.hidden = signedIn;
  authSignedIn.hidden = !signedIn;
  composer.hidden = !signedIn || activeProfileHandle !== `@${currentProfile?.username}`;

  if (!signedIn) return;
  closeAuthPrompt();

  const user = getKnownUserByHandle(`@${currentProfile.username}`) || profileToUser(currentProfile);
  authName.textContent = user.name;
  authHandle.textContent = user.handle;
  authAvatar.innerHTML = renderAvatarVisual(user);
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

  if (!isLoading && activeFilter === "following" && !currentProfile) {
    renderAuthInvite(
      postList,
      "Follow builders, keep up with launches, and turn the feed into your own build room."
    );
    return;
  }

  renderPostList(postList, posts, {
    emptyText: "No posts here yet.",
  });
}

function renderAuthInvite(container, copy) {
  container.innerHTML = "";
  const invite = document.createElement("section");
  invite.className = "empty-state auth-inline-card";
  invite.innerHTML = `
    <p class="auth-inline-kicker">Sign in required</p>
    <h2>Make Builder Story yours.</h2>
    <p>${escapeHtml(copy)}</p>
    <button type="button">Continue with Google</button>
  `;
  invite.querySelector("button").addEventListener("click", () => showAuthPrompt(copy));
  container.append(invite);
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
        <div class="profile-avatar">${renderAvatarVisual(user)}</div>
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
    profileAvatar.textContent = "B";
    profileAvatar.classList.remove("is-editable");
    profileAvatar.removeAttribute("role");
    profileAvatar.removeAttribute("tabindex");
    profileAvatar.removeAttribute("title");
    profileTitle.textContent = "Sign in";
    profileBio.textContent = "Create an account to publish build notes and keep a profile.";
    profileStats.innerHTML = `<span><strong>0</strong> posts</span>`;
    composer.hidden = true;
    renderPostList(profilePostList, [], { emptyText: "Sign in to start your Builder Story profile." });
    return;
  }

  profileAvatar.innerHTML = renderAvatarVisual(user);
  profileAvatar.classList.toggle("is-editable", isOwnProfile);
  if (isOwnProfile) {
    profileAvatar.setAttribute("role", "button");
    profileAvatar.setAttribute("tabindex", "0");
    profileAvatar.title = "Change avatar";
  } else {
    profileAvatar.removeAttribute("role");
    profileAvatar.removeAttribute("tabindex");
    profileAvatar.removeAttribute("title");
  }
  profileTitle.textContent = user.name;
  profileBio.textContent = getProfileSummary(user);
  profileCard.classList.toggle("is-readonly", !isOwnProfile);
  composer.hidden = !isOwnProfile;
  composer.classList.toggle("is-publishing", isPublishingPost);
  composer.querySelectorAll("textarea, input, button").forEach((control) => {
    control.disabled = isPublishingPost;
  });
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
  node.querySelector(".post-time").textContent = ` ${timeAgo(post.createdAt)}`;
  node.querySelector(".post-text").textContent = post.text;

  const image = node.querySelector(".post-image");
  const mediaGrid = node.querySelector(".post-media-grid");
  if ((post.images || []).length > 1) {
    mediaGrid.className = `post-media-grid post-media-grid-${Math.min(post.images.length, 4)}`;
    mediaGrid.innerHTML = post.images
      .slice(0, MAX_MEDIA_FILES_PER_POST)
      .map(
        (item) => `
          <img
            src="${escapeHtml(item.url)}"
            alt="Post attachment"
            loading="lazy"
            decoding="async"
          />
        `
      )
      .join("");
    mediaGrid.hidden = false;
  } else if (isRenderableImageUrl(post.image)) {
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
    button.disabled = pendingReactionPostIds.has(post.id);
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
        avatarUrl: post.author.avatarUrl || "",
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
    handle: userLike.handle || makeCommentHandle(userLike.author || userLike.name),
    name: userLike.author || userLike.name || "Builder",
    avatar: userLike.avatar || "?",
    avatarUrl: userLike.avatarUrl || "",
  };
  const isAvatar = className.includes("avatar");
  const text = isAvatar ? renderAvatarVisual(user) : escapeHtml(label ?? user.avatar);
  return `<button class="${className} profile-trigger" type="button" data-user-handle="${escapeHtml(
    user.handle
  )}" aria-label="Open mini profile ${escapeHtml(user.name)}">${text}</button>`;
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

async function getAccessToken() {
  const { data, error } = await supabaseClient.auth.getSession();
  if (error) throw new Error(error.message);
  const token = data?.session?.access_token || currentSession?.access_token;
  if (!token) throw new Error("Sign in to upload media.");
  return token;
}

async function uploadMediaFile(kind, file, { postId = "" } = {}) {
  const validationError = validateImageFile(file);
  if (validationError) throw new Error(validationError);
  const uploadFile = normalizeImageFile(file);

  const form = new FormData();
  form.append("kind", kind);
  if (postId) form.append("postId", postId);
  form.append("file", uploadFile);

  const response = await fetch(`${MEDIA_UPLOAD_ENDPOINT}/media/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await getAccessToken()}`,
    },
    body: form,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Media upload failed.");
  return payload;
}

async function deleteMediaObjectKey(key) {
  if (!key) return;
  const response = await fetch(`${MEDIA_UPLOAD_ENDPOINT}/media/object`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${await getAccessToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ key }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Media delete failed.");
}

async function createReadyMediaAsset(purpose, uploadedItem) {
  const publicUrl = uploadedItem.publicUrl || getMediaPublicUrl(uploadedItem.key);
  const { data, error } = await supabaseClient
    .from("media_assets")
    .insert({
      owner_id: currentProfile.id,
      object_key: uploadedItem.key,
      public_url: publicUrl,
      cdn_url: publicUrl,
      purpose,
      mime_type: uploadedItem.contentType,
      byte_size: uploadedItem.sizeBytes,
      upload_status: "pending",
    })
    .select("id, object_key, public_url, cdn_url")
    .single();

  if (error) throw new Error(error.message);

  const { error: readyError } = await supabaseClient
    .from("media_assets")
    .update({ upload_status: "ready" })
    .eq("id", data.id)
    .eq("owner_id", currentProfile.id);

  if (readyError) throw new Error(readyError.message);
  return data;
}

async function publishPostSnapshot(snapshot) {
  const form = new FormData();
  form.append("body", snapshot.text);
  if (snapshot.link) {
    form.append(
      "linkPreview",
      JSON.stringify({
        originalUrl: snapshot.externalUrl,
        url: snapshot.link.url,
        domain: getDomain(snapshot.link.url),
        site: snapshot.link.site,
        title: snapshot.link.title,
        desc: snapshot.link.desc,
        image: snapshot.link.image,
      })
    );
  }
  snapshot.mediaFiles.forEach((file) => form.append("file", file));

  const response = await fetch(`${MEDIA_UPLOAD_ENDPOINT}/posts/create`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await getAccessToken()}`,
    },
    body: form,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Post publish failed.");
  return payload;
}

async function createPost() {
  if (!requireProfile()) return;
  if (isPublishingPost) return;
  const snapshot = {
    text: textInput.value.trim(),
    externalUrl: externalUrlInput.value.trim(),
    link: null,
    mediaFiles: selectedPostMediaFiles.map((item) => item.file),
  };
  snapshot.link = makeLinkPreview(snapshot.externalUrl);

  if (!snapshot.text) return;
  if (snapshot.mediaFiles.length > MAX_MEDIA_FILES_PER_POST) {
    setStatus(`Attach up to ${MAX_MEDIA_FILES_PER_POST} images.`);
    return;
  }

  isPublishingPost = true;
  setStatus(snapshot.mediaFiles.length ? "Uploading media..." : "Publishing...");
  renderAll();

  try {
    await publishPostSnapshot(snapshot);
    setStatus("");
  } catch (publishError) {
    isPublishingPost = false;
    setStatus(publishError.message);
    renderAll();
    return;
  }

  isPublishingPost = false;
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

  const previousPosts = posts;
  const postToDelete = posts.find((post) => post.id === postId);
  posts = posts.filter((post) => post.id !== postId);
  renderAll();

  const { data: mediaRows, error: mediaError } = await supabaseClient
    .from("post_media")
    .select("media_id, media:media_assets!post_media_media_id_fkey(id, object_key)")
    .eq("post_id", postId);

  if (mediaError) {
    posts = previousPosts;
    renderAll();
    setStatus(mediaError.message);
    return;
  }

  const { error } = await supabaseClient
    .from("posts")
    .update({ status: "deleted", deleted_at: new Date().toISOString() })
    .eq("id", postId);

  if (error) {
    posts = previousPosts;
    renderAll();
    setStatus(error.message);
    return;
  }

  await Promise.allSettled((mediaRows || []).map((item) => deleteMediaObjectKey(item.media?.object_key)));
  if ((mediaRows || []).length) {
    const mediaIds = mediaRows.map((item) => item.media_id);
    const { error: postMediaDeleteError } = await supabaseClient
      .from("post_media")
      .delete()
      .eq("post_id", postId)
      .in("media_id", mediaIds);
    if (postMediaDeleteError) setStatus(postMediaDeleteError.message);

    const { error: markMediaError } = await supabaseClient
      .from("media_assets")
      .update({ upload_status: "deleted" })
      .in("id", mediaIds)
      .eq("owner_id", currentProfile.id);
    if (markMediaError) setStatus(markMediaError.message);
  }
  if (postToDelete) setStatus("");
  loadAppData({ showLoading: false }).catch((refreshError) => setStatus(refreshError.message));
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
  const profileId = currentProfile.id;
  if (pendingReactionPostIds.has(postId)) return;

  const post = posts.find((item) => item.id === postId);
  if (!post) return;

  const snapshot = {
    selectedReaction: post.selectedReaction,
    reactions: { ...post.reactions },
  };
  pendingReactionPostIds.add(postId);
  const dbType = uiReactionToDb(type);
  let error;

  applyOptimisticReaction(post, type);
  animatedReactionPostId = postId;
  renderAll();

  try {
    if (snapshot.selectedReaction === type) {
      ({ error } = await supabaseClient
        .from("post_reactions")
        .delete()
        .eq("post_id", postId)
        .eq("user_id", profileId));
    } else {
      ({ error } = await supabaseClient.from("post_reactions").upsert(
        {
          post_id: postId,
          user_id: profileId,
          reaction_type: dbType,
        },
        { onConflict: "post_id,user_id" }
      ));
    }

    if (error) {
      restoreReaction(post, snapshot);
      setStatus(error.message);
      renderAll();
      return;
    }

    pendingReactionPostIds.delete(postId);
    await loadAppData({ showLoading: false });
  } finally {
    animatedReactionPostId = null;
    pendingReactionPostIds.delete(postId);
    renderAll();
  }
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

async function updateCurrentAvatar(file) {
  if (!requireProfile()) return;
  const validationError = validateImageFile(file);
  if (validationError) {
    setStatus(validationError);
    return;
  }

  const currentUser = getKnownUserByHandle(`@${currentProfile.username}`) || profileToUser(currentProfile);
  const previousKey = currentUser.avatarObjectKey || "";
  const previousMediaId = currentUser.avatarMediaId || currentProfile.avatar_media_id || "";
  let uploaded = null;
  let mediaAsset = null;
  try {
    setStatus("Uploading avatar...");
    uploaded = await uploadMediaFile("avatar", file);
    mediaAsset = await createReadyMediaAsset("avatar", uploaded);
    const { data, error } = await supabaseClient
      .from("profiles")
      .update({
        avatar_media_id: mediaAsset.id,
      })
      .eq("id", currentProfile.id)
      .select("*")
      .single();

    if (error) throw new Error(error.message);
    currentProfile = data;
    if (previousKey && previousKey !== uploaded.key) {
      await deleteMediaObjectKey(previousKey).catch(() => {});
    }
    if (previousMediaId && previousMediaId !== mediaAsset.id) {
      await supabaseClient
        .from("media_assets")
        .update({ upload_status: "deleted" })
        .eq("id", previousMediaId)
        .eq("owner_id", currentProfile.id);
    }
    setStatus("");
    await loadAppData({ showLoading: false });
  } catch (error) {
    if (uploaded?.key) await deleteMediaObjectKey(uploaded.key).catch(() => {});
    if (mediaAsset?.id) {
      await supabaseClient
        .from("media_assets")
        .update({ upload_status: "deleted" })
        .eq("id", mediaAsset.id)
        .eq("owner_id", currentProfile.id)
        .catch(() => {});
    }
    setStatus(error.message);
  }
}

function requireProfile() {
  if (currentProfile) return true;
  setStatus("Sign in to continue.");
  showAuthPrompt(
    "Create a profile to react, comment, follow builders, and keep your own launch history."
  );
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
  if (!user || !profilePopoverLayer) return;

  closeProfilePopover();

  const popover = document.createElement("aside");
  popover.className = "profile-popover";
  popover.setAttribute("role", "dialog");
  popover.setAttribute("aria-label", `Mini profile for ${user.name}`);
  popover.innerHTML = `
    <div class="profile-popover-art"></div>
    <div class="profile-popover-main">
      <button class="profile-popover-avatar" type="button" data-open-profile="${escapeHtml(user.handle)}" aria-label="Open ${escapeHtml(user.name)} profile">${renderAvatarVisual(user)}</button>
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

  profilePopoverLayer.append(popover);
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
  activeProfilePopoverPosition = null;
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
  activeProfilePopoverPosition = { left, top };
}

function lockProfilePopoverPosition() {
  if (!activeProfilePopover || !activeProfilePopoverPosition) return;
  activeProfilePopover.style.left = `${activeProfilePopoverPosition.left}px`;
  activeProfilePopover.style.top = `${activeProfilePopoverPosition.top}px`;
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

  activeProfileHandle = user.handle;
  feedProfileHandle = null;
  closeProfilePopover();
  closeMobileMenu();
  switchView("profile", { push: true });
  renderAll();
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

function switchView(viewName, options = {}) {
  activeView = viewName;
  document
    .querySelectorAll("[data-view]")
    .forEach((item) => item.classList.toggle("is-active", item.dataset.view === viewName));
  document
    .querySelectorAll(".view")
    .forEach((view) => view.classList.toggle("is-active", view.id === `${viewName}-view`));
  if (options.push || options.replace) {
    writeRouteForView(viewName, options.replace ? "replace" : "push");
  }
}

function closeMobileMenu() {
  if (!mobileMenuButton) return;
  rail.classList.remove("is-open");
  mobileMenuButton.setAttribute("aria-expanded", "false");
}

function setMobileMenuVisibility(value) {
  if (!mobileMenuButton) return;
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

function handleSearchBarScroll() {
  if (!topSearch) return;
  const currentScrollY = Math.max(0, window.scrollY);
  const delta = currentScrollY - lastSearchScrollY;
  lastSearchScrollY = currentScrollY;

  topSearch.classList.toggle("is-floating", currentScrollY > 24);
  if (currentScrollY < 80 || delta < -8) {
    topSearch.classList.remove("is-hidden");
    return;
  }

  if (delta > 12) {
    topSearch.classList.add("is-hidden");
  }
}

function toggleMobileMenu() {
  if (!mobileMenuButton) return;
  const isOpen = rail.classList.toggle("is-open");
  mobileMenuButton.setAttribute("aria-expanded", String(isOpen));
  if (isOpen) setMobileMenuVisibility(1);
}

function renderSelectedMediaPreviews() {
  imagePreview.hidden = selectedPostMediaFiles.length === 0;
  imagePreview.innerHTML = selectedPostMediaFiles
    .map(
      (item, index) => `
        <button class="image-chip" type="button" data-clear-image="${index}">
          <img src="${escapeHtml(item.previewUrl)}" alt="" />
          <span>${escapeHtml(item.file.name)}</span>
          <strong aria-hidden="true">x</strong>
        </button>
      `
    )
    .join("");
}

function clearImagePreview() {
  imageReadToken += 1;
  imageFileInput.value = "";
  selectedPostMediaFiles.forEach((item) => URL.revokeObjectURL(item.previewUrl));
  selectedPostMediaFiles = [];
  renderSelectedMediaPreviews();
}

async function signInWithGoogle() {
  if (!supabaseClient) {
    setStatus("Supabase SDK did not load.");
    return;
  }

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
    if (button.dataset.view === "profile" && !currentProfile) {
      showAuthPrompt("Sign in to publish updates, save your profile, and keep a public build story.");
      return;
    }
    if (button.dataset.view === "profile" && currentProfile) {
      activeProfileHandle = `@${currentProfile.username}`;
    }
    switchView(button.dataset.view, { push: true });
    renderAll();
    closeMobileMenu();
  });
});

themeToggle?.addEventListener("click", () => {
  setTheme(document.body.classList.contains("theme-dark") ? "light" : "dark");
});

newPostButton?.addEventListener("click", () => {
  if (!currentProfile) {
    showAuthPrompt("Sign in to post what you shipped and get feedback from other builders.");
    return;
  }

  activeProfileHandle = `@${currentProfile.username}`;
  switchView("profile", { push: true });
  renderAll();
  closeMobileMenu();
  requestAnimationFrame(() => textInput?.focus());
});

settingsButton?.addEventListener("click", () => {
  showAuthPrompt("Settings are tied to your Builder Story profile. Sign in to manage them.");
});

authPromptClose?.addEventListener("click", closeAuthPrompt);
authPromptSignin?.addEventListener("click", signInWithGoogle);
authPrompt?.addEventListener("click", (event) => {
  if (event.target === authPrompt) closeAuthPrompt();
});

googleSigninButton.addEventListener("click", signInWithGoogle);
authSignout.addEventListener("click", async () => {
  await supabaseClient.auth.signOut();
});

mobileMenuButton.addEventListener("click", toggleMobileMenu);
window.addEventListener("scroll", handleMobileMenuScroll, { passive: true });
window.addEventListener("scroll", handleSearchBarScroll, { passive: true });
window.addEventListener("scroll", lockProfilePopoverPosition, { passive: true });
window.addEventListener("resize", lockProfilePopoverPosition, { passive: true });
window.addEventListener(
  "wheel",
  (event) => {
    if (event.deltaY < 0) topSearch?.classList.remove("is-hidden");
  },
  { passive: true }
);
window.addEventListener("popstate", () => {
  applyRouteFromLocation();
  renderAll();
});

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
  if (event.key === "Escape") closeProfilePopover();
});

profileAvatar?.addEventListener("click", () => {
  if (profileAvatar.classList.contains("is-editable")) avatarFileInput?.click();
});

profileAvatar?.addEventListener("keydown", (event) => {
  if (!profileAvatar.classList.contains("is-editable")) return;
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  avatarFileInput?.click();
});

avatarFileInput?.addEventListener("change", async () => {
  const file = avatarFileInput.files?.[0];
  avatarFileInput.value = "";
  if (file) await updateCurrentAvatar(file);
});

document.querySelector("[data-attach-image]").addEventListener("click", () => {
  imageFileInput.click();
});

imageFileInput.addEventListener("change", () => {
  const files = Array.from(imageFileInput.files || []);
  imageReadToken += 1;

  if (!files.length) {
    imageFileInput.value = "";
    return;
  }

  for (const file of files) {
    if (selectedPostMediaFiles.length >= MAX_MEDIA_FILES_PER_POST) {
      setStatus(`Attach up to ${MAX_MEDIA_FILES_PER_POST} images.`);
      break;
    }
    const validationError = validateImageFile(file);
    if (validationError) {
      setStatus(validationError);
      continue;
    }
    const normalizedFile = normalizeImageFile(file);
    selectedPostMediaFiles.push({
      file: normalizedFile,
      previewUrl: URL.createObjectURL(normalizedFile),
    });
  }

  imageFileInput.value = "";
  renderSelectedMediaPreviews();
});

imagePreview.addEventListener("click", (event) => {
  const clearButton = event.target.closest("[data-clear-image]");
  if (!clearButton) return;
  const index = Number(clearButton.dataset.clearImage);
  const [removed] = selectedPostMediaFiles.splice(index, 1);
  if (removed) URL.revokeObjectURL(removed.previewUrl);
  renderSelectedMediaPreviews();
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

initializeTheme();
initializeApp();
