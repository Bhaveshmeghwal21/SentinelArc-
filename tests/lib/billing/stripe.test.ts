import {
  createCustomer,
  createSubscription,
  reportUsage,
  getUsage,
  handleWebhook,
  constructWebhookEvent,
  PLAN_CONFIGS,
  PLAN_KEY_TO_TIER,
  setStripeInstance,
} from "@/lib/billing/stripe";
import Stripe from "stripe";

// Create mock Stripe instance
const mockStripe = {
  customers: {
    create: jest.fn(),
  },
  subscriptions: {
    create: jest.fn(),
  },
  subscriptionItems: {
    createUsageRecord: jest.fn(),
    listUsageRecordSummaries: jest.fn(),
  },
  webhooks: {
    constructEvent: jest.fn(),
  },
} as unknown as Stripe;

describe("Stripe Billing Module", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setStripeInstance(mockStripe);
  });

  afterAll(() => {
    setStripeInstance(null);
  });

  describe("createCustomer", () => {
    it("should create a Stripe customer with correct parameters", async () => {
      const mockCustomer = {
        id: "cus_test123",
        name: "Test Corp",
        email: "admin@test.com",
        metadata: { clientId: "client-1" },
      };

      (mockStripe.customers.create as jest.Mock).mockResolvedValue(mockCustomer);

      const result = await createCustomer({
        clientId: "client-1",
        name: "Test Corp",
        email: "admin@test.com",
      });

      expect(mockStripe.customers.create).toHaveBeenCalledWith({
        name: "Test Corp",
        email: "admin@test.com",
        metadata: { clientId: "client-1" },
      });
      expect(result.id).toBe("cus_test123");
    });
  });

  describe("createSubscription", () => {
    it("should create a subscription with the correct price ID", async () => {
      const mockSubscription = {
        id: "sub_test123",
        status: "active",
        items: { data: [{ id: "si_test123" }] },
      };

      (mockStripe.subscriptions.create as jest.Mock).mockResolvedValue(
        mockSubscription
      );

      const result = await createSubscription({
        customerId: "cus_test123",
        plan: "STARTER",
      });

      expect(mockStripe.subscriptions.create).toHaveBeenCalledWith({
        customer: "cus_test123",
        items: [{ price: PLAN_CONFIGS.STARTER.priceId }],
        metadata: {
          plan: "STARTER",
          conversationLimit: String(PLAN_CONFIGS.STARTER.conversationLimit),
        },
      });
      expect(result.id).toBe("sub_test123");
    });

    it("should throw error for invalid plan", async () => {
      await expect(
        createSubscription({
          customerId: "cus_test123",
          plan: "INVALID" as keyof typeof PLAN_CONFIGS,
        })
      ).rejects.toThrow("Invalid plan: INVALID");
    });

    it("should use correct limits for each plan tier", () => {
      expect(PLAN_CONFIGS.STARTER.conversationLimit).toBe(10_000);
      expect(PLAN_CONFIGS.STARTER.monthlyPrice).toBe(199);
      expect(PLAN_CONFIGS.GROWTH.conversationLimit).toBe(50_000);
      expect(PLAN_CONFIGS.GROWTH.monthlyPrice).toBe(499);
      expect(PLAN_CONFIGS.ENTERPRISE.conversationLimit).toBe(250_000);
      expect(PLAN_CONFIGS.ENTERPRISE.monthlyPrice).toBe(999);
    });
  });

  describe("reportUsage", () => {
    it("should report usage to Stripe with correct parameters", async () => {
      const mockUsageRecord = { id: "mbur_test123", quantity: 100 };

      (
        mockStripe.subscriptionItems.createUsageRecord as jest.Mock
      ).mockResolvedValue(mockUsageRecord);

      const timestamp = Math.floor(Date.now() / 1000);
      const result = await reportUsage({
        subscriptionItemId: "si_test123",
        quantity: 100,
        timestamp,
      });

      expect(
        mockStripe.subscriptionItems.createUsageRecord
      ).toHaveBeenCalledWith("si_test123", {
        quantity: 100,
        timestamp,
        action: "set",
      });
      expect(result.quantity).toBe(100);
    });
  });

  describe("getUsage", () => {
    it("should retrieve usage record summaries", async () => {
      const mockSummaries = {
        data: [
          { total_usage: 500, period: { start: 1700000000, end: 1702000000 } },
        ],
      };

      (
        mockStripe.subscriptionItems.listUsageRecordSummaries as jest.Mock
      ).mockResolvedValue(mockSummaries);

      const result = await getUsage({ subscriptionItemId: "si_test123" });

      expect(
        mockStripe.subscriptionItems.listUsageRecordSummaries
      ).toHaveBeenCalledWith("si_test123");
      expect(result.data).toHaveLength(1);
    });
  });

  describe("handleWebhook", () => {
    it("should process subscription created events", () => {
      const event = {
        type: "customer.subscription.created",
        data: {
          object: {
            id: "sub_test123",
            customer: "cus_test123",
            status: "active",
            metadata: { plan: "STARTER" },
          },
        },
      } as unknown as Stripe.Event;

      const result = handleWebhook(event);

      expect(result).toEqual({
        eventType: "customer.subscription.created",
        customerId: "cus_test123",
        subscriptionId: "sub_test123",
        plan: "STARTER",
        status: "active",
      });
    });

    it("should process subscription updated events", () => {
      const event = {
        type: "customer.subscription.updated",
        data: {
          object: {
            id: "sub_test123",
            customer: "cus_test123",
            status: "active",
            metadata: { plan: "GROWTH" },
          },
        },
      } as unknown as Stripe.Event;

      const result = handleWebhook(event);

      expect(result).toEqual({
        eventType: "customer.subscription.updated",
        customerId: "cus_test123",
        subscriptionId: "sub_test123",
        plan: "GROWTH",
        status: "active",
      });
    });

    it("should process subscription deleted events", () => {
      const event = {
        type: "customer.subscription.deleted",
        data: {
          object: {
            id: "sub_test123",
            customer: "cus_test123",
            status: "canceled",
            metadata: { plan: "STARTER" },
          },
        },
      } as unknown as Stripe.Event;

      const result = handleWebhook(event);

      expect(result).toEqual({
        eventType: "customer.subscription.deleted",
        customerId: "cus_test123",
        subscriptionId: "sub_test123",
        plan: "STARTER",
        status: "canceled",
      });
    });

    it("should process payment failed events", () => {
      const event = {
        type: "invoice.payment_failed",
        data: {
          object: {
            id: "in_test123",
            customer: "cus_test123",
            subscription: "sub_test123",
          },
        },
      } as unknown as Stripe.Event;

      const result = handleWebhook(event);

      expect(result).toEqual({
        eventType: "invoice.payment_failed",
        customerId: "cus_test123",
        subscriptionId: "sub_test123",
        status: "payment_failed",
      });
    });

    it("should return null for unhandled event types", () => {
      const event = {
        type: "charge.succeeded",
        data: {
          object: {},
        },
      } as unknown as Stripe.Event;

      const result = handleWebhook(event);
      expect(result).toBeNull();
    });

    it("should handle customer as object (not string)", () => {
      const event = {
        type: "customer.subscription.created",
        data: {
          object: {
            id: "sub_test123",
            customer: { id: "cus_test123" },
            status: "active",
            metadata: { plan: "ENTERPRISE" },
          },
        },
      } as unknown as Stripe.Event;

      const result = handleWebhook(event);
      expect(result?.customerId).toBe("cus_test123");
    });
  });

  describe("constructWebhookEvent", () => {
    it("should throw if STRIPE_WEBHOOK_SECRET is not set", () => {
      delete process.env.STRIPE_WEBHOOK_SECRET;

      expect(() =>
        constructWebhookEvent("body", "sig")
      ).toThrow("STRIPE_WEBHOOK_SECRET is not configured");
    });

    it("should call stripe.webhooks.constructEvent with correct params", () => {
      process.env.STRIPE_WEBHOOK_SECRET = "whsec_test123";

      const mockEvent = { type: "test", data: {} } as unknown as Stripe.Event;
      (mockStripe.webhooks.constructEvent as jest.Mock).mockReturnValue(
        mockEvent
      );

      const result = constructWebhookEvent("raw_body", "sig_header");

      expect(mockStripe.webhooks.constructEvent).toHaveBeenCalledWith(
        "raw_body",
        "sig_header",
        "whsec_test123"
      );
      expect(result).toBe(mockEvent);

      delete process.env.STRIPE_WEBHOOK_SECRET;
    });
  });

  describe("PLAN_KEY_TO_TIER mapping", () => {
    it("should map STARTER to STARTER database tier", () => {
      expect(PLAN_KEY_TO_TIER["STARTER"]).toBe("STARTER");
    });

    it("should map GROWTH to PROFESSIONAL database tier", () => {
      expect(PLAN_KEY_TO_TIER["GROWTH"]).toBe("PROFESSIONAL");
    });

    it("should map ENTERPRISE to ENTERPRISE database tier", () => {
      expect(PLAN_KEY_TO_TIER["ENTERPRISE"]).toBe("ENTERPRISE");
    });

    it("should have a mapping for every plan in PLAN_CONFIGS", () => {
      for (const planKey of Object.keys(PLAN_CONFIGS)) {
        expect(PLAN_KEY_TO_TIER[planKey]).toBeDefined();
        expect(typeof PLAN_KEY_TO_TIER[planKey]).toBe("string");
      }
    });

    it("should only map to valid PlanTier enum values", () => {
      const validTiers = ["FREE", "STARTER", "PROFESSIONAL", "ENTERPRISE"];
      for (const tier of Object.values(PLAN_KEY_TO_TIER)) {
        expect(validTiers).toContain(tier);
      }
    });
  });
});
