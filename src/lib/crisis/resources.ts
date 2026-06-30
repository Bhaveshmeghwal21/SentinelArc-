/**
 * Crisis resource definitions organized by region and type.
 * v1 includes US resources with a structure supporting future regional expansion.
 */

export type ContactMethod = "phone" | "text" | "chat" | "web";

export interface CrisisResource {
  id: string;
  name: string;
  contactMethod: ContactMethod;
  contactValue: string;
  description: string;
  region: string;
  /** Optional applicability rules for resource selection */
  applicability?: {
    /** Age range this resource specializes in */
    ageRange?: { min?: number; max?: number };
    /** Specific populations this resource serves */
    populations?: string[];
    /** Categories this resource is especially relevant for */
    categories?: string[];
  };
}

/**
 * US crisis resources - always available as default.
 */
export const US_RESOURCES: CrisisResource[] = [
  {
    id: "us-988-phone",
    name: "988 Suicide & Crisis Lifeline",
    contactMethod: "phone",
    contactValue: "988",
    description:
      "Free, confidential 24/7 support for people in suicidal crisis or emotional distress.",
    region: "US",
  },
  {
    id: "us-988-chat",
    name: "988 Suicide & Crisis Lifeline Chat",
    contactMethod: "chat",
    contactValue: "https://988lifeline.org/chat/",
    description:
      "Online chat for people in suicidal crisis or emotional distress.",
    region: "US",
  },
  {
    id: "us-crisis-text",
    name: "Crisis Text Line",
    contactMethod: "text",
    contactValue: "Text HELLO to 741741",
    description:
      "Free 24/7 crisis support via text message. Text HELLO to 741741.",
    region: "US",
  },
  {
    id: "us-trevor-phone",
    name: "The Trevor Project",
    contactMethod: "phone",
    contactValue: "1-866-488-7386",
    description:
      "Crisis intervention and suicide prevention for LGBTQ+ young people.",
    region: "US",
    applicability: {
      ageRange: { min: 10, max: 25 },
      populations: ["LGBTQ+", "youth"],
      categories: ["self_harm"],
    },
  },
  {
    id: "us-trevor-text",
    name: "The Trevor Project Text",
    contactMethod: "text",
    contactValue: "Text START to 678-678",
    description:
      "Crisis support via text for LGBTQ+ young people. Text START to 678-678.",
    region: "US",
    applicability: {
      ageRange: { min: 10, max: 25 },
      populations: ["LGBTQ+", "youth"],
      categories: ["self_harm"],
    },
  },
];

/**
 * All available resources by region.
 */
const RESOURCES_BY_REGION: Record<string, CrisisResource[]> = {
  US: US_RESOURCES,
};

/**
 * Get crisis resources for a given region.
 * Falls back to US resources if region is not found.
 */
export function getResourcesForRegion(region?: string): CrisisResource[] {
  if (region && RESOURCES_BY_REGION[region]) {
    return RESOURCES_BY_REGION[region];
  }
  return US_RESOURCES;
}

/**
 * Get default crisis resources that always include at minimum:
 * - One phone option
 * - One text option
 *
 * This is the fail-safe set used when no region context is available.
 */
export function getDefaultResources(): CrisisResource[] {
  return [
    US_RESOURCES[0], // 988 phone
    US_RESOURCES[2], // Crisis Text Line
  ];
}

/**
 * Validate that a set of resources contains the minimum required options.
 */
export function validateResources(resources: CrisisResource[]): boolean {
  const hasPhone = resources.some((r) => r.contactMethod === "phone");
  const hasText = resources.some((r) => r.contactMethod === "text");
  return hasPhone && hasText && resources.length >= 2;
}
