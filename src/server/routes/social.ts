import { Router } from "express";
import { asyncHandler } from "../http.js";
import { requireAuth } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import {
  callAnswerSchema,
  callCreateSchema,
  callIceSchema,
  commentCreateSchema,
  conversationCreateSchema,
  discoverQuerySchema,
  duoRequestSchema,
  friendRequestSchema,
  messageCreateSchema,
  paginationSchema,
  postCreateSchema,
  reportSchema,
  storyCreateSchema,
} from "../../domain/validation.js";
import { discoverPlayers, dismissPlayer, recommendPlayers } from "../services/discovery.js";
import {
  acceptFriendRequest,
  blockUser,
  createDuoRequest,
  createReport,
  declineFriendRequest,
  followUser,
  listBlocks,
  listDuoRequests,
  listMatches,
  respondDuo,
  sendFriendRequest,
  unblockUser,
  unfollowUser,
} from "../services/social.js";
import {
  getOrCreateConversation,
  listConversations,
  listMessages,
  sendMessage,
} from "../services/messaging.js";
import {
  addComment,
  createPost,
  deletePost,
  listFeed,
  listFriendRequests,
  listFriends,
  toggleLike,
} from "../services/feed.js";
import { createStory, deleteStory, listStories, viewStory } from "../services/stories.js";
import {
  addIce,
  answerCall,
  declineCall,
  hangupCall,
  incomingCalls,
  listIce,
  serializeCall,
  startCall,
} from "../services/calls.js";
import type { AuthedRequest } from "../types.js";

export const socialRouter = Router();

socialRouter.get(
  "/discover",
  requireAuth,
  asyncHandler(async (req, res) => {
    const query = discoverQuerySchema.parse(req.query);
    res.json(await discoverPlayers((req as AuthedRequest).user.id, query));
  }),
);

socialRouter.get(
  "/discover/recommendations",
  requireAuth,
  asyncHandler(async (req, res) => {
    const items = await recommendPlayers((req as AuthedRequest).user.id);
    res.json({ items });
  }),
);

socialRouter.get(
  "/players/search",
  requireAuth,
  asyncHandler(async (req, res) => {
    const query = discoverQuerySchema.parse(req.query);
    res.json(await discoverPlayers((req as AuthedRequest).user.id, query));
  }),
);

socialRouter.post(
  "/discover/:id/dismiss",
  requireAuth,
  asyncHandler(async (req, res) => {
    await dismissPlayer((req as AuthedRequest).user.id, String(req.params.id));
    res.json({ ok: true });
  }),
);

socialRouter.post(
  "/duo-requests",
  requireAuth,
  rateLimit({ windowMs: 60_000, max: 10, key: (req) => (req as AuthedRequest).user.id }),
  asyncHandler(async (req, res) => {
    const body = duoRequestSchema.parse(req.body);
    res.status(201).json({ request: await createDuoRequest((req as AuthedRequest).user.id, body) });
  }),
);

socialRouter.get(
  "/duo-requests",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ items: await listDuoRequests((req as AuthedRequest).user.id) });
  }),
);

socialRouter.get(
  "/matches",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ items: await listMatches((req as AuthedRequest).user.id) });
  }),
);

for (const action of ["accept", "decline", "cancel"] as const) {
  socialRouter.post(
    `/duo-requests/:id/${action}`,
    requireAuth,
    asyncHandler(async (req, res) => {
      await respondDuo((req as AuthedRequest).user.id, String(req.params.id), action);
      res.json({ ok: true });
    }),
  );
}

socialRouter.post(
  "/users/:id/follow",
  requireAuth,
  asyncHandler(async (req, res) => {
    await followUser((req as AuthedRequest).user.id, String(req.params.id));
    res.json({ ok: true });
  }),
);

socialRouter.delete(
  "/users/:id/follow",
  requireAuth,
  asyncHandler(async (req, res) => {
    await unfollowUser((req as AuthedRequest).user.id, String(req.params.id));
    res.json({ ok: true });
  }),
);

socialRouter.post(
  "/friend-requests",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = friendRequestSchema.parse(req.body);
    res
      .status(201)
      .json({ request: await sendFriendRequest((req as AuthedRequest).user.id, body.userId) });
  }),
);

socialRouter.post(
  "/friend-requests/:id/accept",
  requireAuth,
  asyncHandler(async (req, res) => {
    await acceptFriendRequest((req as AuthedRequest).user.id, String(req.params.id));
    res.json({ ok: true });
  }),
);

socialRouter.post(
  "/friend-requests/:id/decline",
  requireAuth,
  asyncHandler(async (req, res) => {
    await declineFriendRequest((req as AuthedRequest).user.id, String(req.params.id));
    res.json({ ok: true });
  }),
);

socialRouter.get(
  "/friend-requests",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ items: await listFriendRequests((req as AuthedRequest).user.id) });
  }),
);

socialRouter.get(
  "/friends",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ items: await listFriends((req as AuthedRequest).user.id) });
  }),
);

socialRouter.get(
  "/stories",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await listStories((req as AuthedRequest).user.id));
  }),
);

socialRouter.post(
  "/stories",
  requireAuth,
  rateLimit({ windowMs: 60_000, max: 8, key: (req) => `story:${(req as AuthedRequest).user.id}` }),
  asyncHandler(async (req, res) => {
    const body = storyCreateSchema.parse(req.body);
    res.status(201).json(await createStory((req as AuthedRequest).user.id, body));
  }),
);

socialRouter.post(
  "/stories/:id/view",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await viewStory((req as AuthedRequest).user.id, String(req.params.id)));
  }),
);

socialRouter.delete(
  "/stories/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    await deleteStory((req as AuthedRequest).user.id, String(req.params.id));
    res.json({ ok: true });
  }),
);

socialRouter.get(
  "/feed",
  requireAuth,
  asyncHandler(async (req, res) => {
    const query = paginationSchema.parse(req.query);
    res.json(await listFeed((req as AuthedRequest).user.id, query.cursor, query.limit ?? 20));
  }),
);

socialRouter.post(
  "/posts",
  requireAuth,
  rateLimit({ windowMs: 60_000, max: 8, key: (req) => (req as AuthedRequest).user.id }),
  asyncHandler(async (req, res) => {
    const body = postCreateSchema.parse(req.body);
    res.status(201).json({
      post: await createPost((req as AuthedRequest).user.id, body.body, body.visibility),
    });
  }),
);

socialRouter.delete(
  "/posts/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    await deletePost((req as AuthedRequest).user.id, String(req.params.id));
    res.json({ ok: true });
  }),
);

socialRouter.post(
  "/posts/:id/like",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ post: await toggleLike((req as AuthedRequest).user.id, String(req.params.id)) });
  }),
);

socialRouter.post(
  "/posts/:id/comments",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = commentCreateSchema.parse(req.body);
    res.status(201).json({
      post: await addComment((req as AuthedRequest).user.id, String(req.params.id), body.body),
    });
  }),
);

socialRouter.post(
  "/calls",
  requireAuth,
  rateLimit({ windowMs: 60_000, max: 8, key: (req) => `call:${(req as AuthedRequest).user.id}` }),
  asyncHandler(async (req, res) => {
    const body = callCreateSchema.parse(req.body);
    res.status(201).json({
      call: await startCall((req as AuthedRequest).user.id, body.userId, body.kind, body.offerSdp),
    });
  }),
);

socialRouter.get(
  "/calls/active",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ items: await incomingCalls((req as AuthedRequest).user.id) });
  }),
);

socialRouter.get(
  "/calls/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ call: await serializeCall((req as AuthedRequest).user.id, String(req.params.id)) });
  }),
);

socialRouter.post(
  "/calls/:id/answer",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = callAnswerSchema.parse(req.body);
    res.json({
      call: await answerCall((req as AuthedRequest).user.id, String(req.params.id), body.answerSdp),
    });
  }),
);

socialRouter.post(
  "/calls/:id/decline",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ call: await declineCall((req as AuthedRequest).user.id, String(req.params.id)) });
  }),
);

socialRouter.post(
  "/calls/:id/hangup",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ call: await hangupCall((req as AuthedRequest).user.id, String(req.params.id)) });
  }),
);

socialRouter.post(
  "/calls/:id/ice",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = callIceSchema.parse(req.body);
    res.json(await addIce((req as AuthedRequest).user.id, String(req.params.id), body.candidate));
  }),
);

socialRouter.get(
  "/calls/:id/ice",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await listIce((req as AuthedRequest).user.id, String(req.params.id)));
  }),
);

socialRouter.post(
  "/users/:id/block",
  requireAuth,
  asyncHandler(async (req, res) => {
    await blockUser((req as AuthedRequest).user.id, String(req.params.id));
    res.json({ ok: true });
  }),
);

socialRouter.delete(
  "/users/:id/block",
  requireAuth,
  asyncHandler(async (req, res) => {
    await unblockUser((req as AuthedRequest).user.id, String(req.params.id));
    res.json({ ok: true });
  }),
);

socialRouter.get(
  "/me/blocks",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ items: await listBlocks((req as AuthedRequest).user.id) });
  }),
);

socialRouter.post(
  "/reports",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = reportSchema.parse(req.body);
    res.status(201).json({ report: await createReport((req as AuthedRequest).user.id, body) });
  }),
);

socialRouter.get(
  "/conversations",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ items: await listConversations((req as AuthedRequest).user.id) });
  }),
);

socialRouter.post(
  "/conversations",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = conversationCreateSchema.parse(req.body);
    const conversation = await getOrCreateConversation((req as AuthedRequest).user.id, body.userId);
    res.status(201).json({ conversation });
  }),
);

socialRouter.get(
  "/conversations/:id/messages",
  requireAuth,
  asyncHandler(async (req, res) => {
    const query = paginationSchema.parse(req.query);
    res.json(
      await listMessages(
        (req as AuthedRequest).user.id,
        String(req.params.id),
        query.cursor,
        query.limit,
      ),
    );
  }),
);

socialRouter.post(
  "/conversations/:id/messages",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = messageCreateSchema.parse(req.body);
    res.status(201).json({
      message: await sendMessage((req as AuthedRequest).user.id, String(req.params.id), body.body),
    });
  }),
);
