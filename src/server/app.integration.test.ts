import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";
import { prisma } from "./db.js";
import { grantCoins, seedCatalog, userIdFromEmail } from "../test/helpers.js";
import { getSandboxIntent } from "./services/spv.js";

const server = createApp();

function client() {
  return request.agent(server);
}

describe("KuchuPuchu API", () => {
  beforeAll(async () => {
    await seedCatalog();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("rejects unauthorized access", async () => {
    const res = await request(server).get("/api/me");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("registers, verifies email, and returns the current user", async () => {
    const agent = client();
    const created = await agent.post("/api/auth/register").send({
      email: "one@example.com",
      password: "StrongPass123",
      displayName: "One",
      username: "player_one",
    });
    expect(created.status).toBe(201);
    const me = await agent.get("/api/me");
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe("one@example.com");
    expect(me.body.user.wallet.balance).toBe(0);

    const mail = await prisma.devMailbox.findFirst({
      where: { toEmail: "one@example.com" },
      orderBy: { createdAt: "desc" },
    });
    expect(mail?.body).toContain("verify-email");
    const token = mail?.body.match(/token=([A-Za-z0-9_-]+)/)?.[1];
    expect(token).toBeTruthy();
    const verified = await agent.post("/api/auth/verify-email").send({ token });
    expect(verified.status).toBe(200);
  });

  it("does not leak another user's email or exact location", async () => {
    const a = client();
    const b = client();
    await a.post("/api/auth/register").send({
      email: "alpha@example.com",
      password: "StrongPass123",
      displayName: "Alpha",
      username: "alpha_user",
    });
    await b.post("/api/auth/register").send({
      email: "beta@example.com",
      password: "StrongPass123",
      displayName: "Beta",
      username: "beta_user",
    });
    await a.patch("/api/me/profile").send({
      district: "Rajshahi",
      approximateArea: "Boalia ward 8, house 12",
      ffUid: "99887766",
    });
    await a.patch("/api/me/privacy").send({
      showDistrict: false,
      showApproximateArea: false,
      showFfUid: false,
    });
    const alpha = await userIdFromEmail("alpha@example.com");
    const viewed = await b.get(`/api/users/${alpha.id}`);
    expect(viewed.status).toBe(200);
    expect(viewed.body.user.ffUid).toBeNull();
    expect(viewed.body.user.district).toBeNull();
    expect(viewed.body.user.approximateArea).toBeNull();
    expect(viewed.body.user).not.toHaveProperty("email");
  });

  it("blocks discovery, messaging and gifting after a block", async () => {
    const a = client();
    const b = client();
    await a.post("/api/auth/register").send({
      email: "blocka@example.com",
      password: "StrongPass123",
      displayName: "BlockA",
      username: "block_a",
    });
    await b.post("/api/auth/register").send({
      email: "blockb@example.com",
      password: "StrongPass123",
      displayName: "BlockB",
      username: "block_b",
    });
    const userA = await userIdFromEmail("blocka@example.com");
    const userB = await userIdFromEmail("blockb@example.com");
    await a.post(`/api/users/${userB.id}/block`).send();
    const discover = await a.get("/api/discover");
    expect(
      discover.body.items.find((item: { userId: string }) => item.userId === userB.id),
    ).toBeFalsy();
    const message = await b.post("/api/conversations").send({ userId: userA.id });
    expect(message.status).toBe(403);
    await grantCoins(userB.id, 50);
    await b.post("/api/store/orders").send({ productId: "prd_test", idempotencyKey: "gift-setup" });
    const inv = await b.get("/api/inventory");
    const itemId = inv.body.items[0].id as string;
    const gift = await b.post("/api/gifts").send({
      inventoryId: itemId,
      receiverId: userA.id,
      idempotencyKey: "gift-blocked",
    });
    expect(gift.status).toBe(403);
  });

  it("credits coins through the ledger and refuses client balances", async () => {
    const agent = client();
    await agent.post("/api/auth/register").send({
      email: "coins@example.com",
      password: "StrongPass123",
      displayName: "Coins",
      username: "coin_user",
    });
    const user = await userIdFromEmail("coins@example.com");
    await grantCoins(user.id, 80);
    const wallet = await agent.get("/api/wallet");
    expect(wallet.body.wallet.balance).toBe(80);
    const purchase = await agent
      .post("/api/store/orders")
      .send({ productId: "prd_test", idempotencyKey: "buy-order-1" });
    expect(purchase.status).toBe(201);
    const again = await agent
      .post("/api/store/orders")
      .send({ productId: "prd_test", idempotencyKey: "buy-order-1" });
    expect(again.body.order.id).toBe(purchase.body.order.id);
    const after = await agent.get("/api/wallet");
    expect(after.body.wallet.balance).toBe(55);
    const replay = await agent
      .post("/api/store/orders")
      .send({ productId: "prd_test", idempotencyKey: "buy-order-2" });
    expect(replay.status).toBe(409);
  });

  it("settles an SPV sandbox payment exactly once", async () => {
    const agent = client();
    await agent.post("/api/auth/register").send({
      email: "pay@example.com",
      password: "StrongPass123",
      displayName: "Pay",
      username: "pay_user",
    });
    const created = await agent
      .post("/api/payments/orders")
      .send({ packageId: "pkg_test", idempotencyKey: "pay-order-1" });
    expect(created.status).toBe(201);
    const paymentId = created.body.order.providerPaymentId as string;
    const intent = getSandboxIntent(paymentId);
    expect(intent?.secret).toBeTruthy();
    const first = await agent
      .post(`/api/sandbox/payments/${paymentId}/complete`)
      .send({ secret: intent!.secret });
    expect(first.status).toBe(200);
    expect(first.body.order.status).toBe("PAID");
    const second = await agent
      .post(`/api/sandbox/payments/${paymentId}/complete`)
      .send({ secret: intent!.secret });
    expect(second.body.order.status).toBe("PAID");
    const wallet = await agent.get("/api/wallet");
    expect(wallet.body.wallet.balance).toBe(100);
    const ledger = await agent.get("/api/wallet/transactions");
    const credits = ledger.body.items.filter(
      (row: { source: string }) => row.source === "spv_purchase",
    );
    expect(credits).toHaveLength(1);
  });

  it("rewards a verified referral once", async () => {
    const referrer = client();
    await referrer.post("/api/auth/register").send({
      email: "ref@example.com",
      password: "StrongPass123",
      displayName: "Referrer",
      username: "referrer1",
    });
    const me = await referrer.get("/api/me");
    const code = me.body.user.referralCode as string;
    const newbie = client();
    await newbie.post("/api/auth/register").send({
      email: "new@example.com",
      password: "StrongPass123",
      displayName: "Newbie",
      username: "newbie1",
      referralCode: code,
    });
    const mail = await prisma.devMailbox.findFirst({
      where: { toEmail: "new@example.com" },
      orderBy: { createdAt: "desc" },
    });
    const token = mail?.body.match(/token=([A-Za-z0-9_-]+)/)?.[1];
    await newbie.post("/api/auth/verify-email").send({ token });
    const wallet = await referrer.get("/api/wallet");
    expect(wallet.body.wallet.balance).toBe(80);
    const again = await prisma.referral.findMany({
      where: { referrerId: (await userIdFromEmail("ref@example.com")).id },
    });
    expect(again).toHaveLength(1);
  });

  it("lets two players form a duo match", async () => {
    const a = client();
    const b = client();
    await a.post("/api/auth/register").send({
      email: "duo1@example.com",
      password: "StrongPass123",
      displayName: "DuoOne",
      username: "duo_one",
    });
    await b.post("/api/auth/register").send({
      email: "duo2@example.com",
      password: "StrongPass123",
      displayName: "DuoTwo",
      username: "duo_two",
    });
    const userB = await userIdFromEmail("duo2@example.com");
    const created = await a.post("/api/duo-requests").send({
      targetId: userB.id,
      mode: "CLASH_SQUAD",
      message: "Ranked tonight?",
    });
    expect(created.status).toBe(201);
    const accept = await b.post(`/api/duo-requests/${created.body.request.id}/accept`).send();
    expect(accept.status).toBe(200);
    const matches = await a.get("/api/matches");
    expect(matches.body.items.length).toBe(1);
  });

  it("forbids privilege escalation into admin routes", async () => {
    const agent = client();
    await agent.post("/api/auth/register").send({
      email: "normie@example.com",
      password: "StrongPass123",
      displayName: "Normie",
      username: "normie1",
    });
    const res = await agent.get("/api/admin/dashboard");
    expect(res.status).toBe(403);
    const grant = await agent.post("/api/admin/ledger/grant").send({
      userId: "usr_nope",
      amount: 99999,
      reason: "please",
      idempotencyKey: "nope",
    });
    expect(grant.status).toBe(403);
  });
});
