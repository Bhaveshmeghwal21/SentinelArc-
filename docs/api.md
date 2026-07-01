# SentinelArc Ingestion API

## Overview

The Ingestion API is the primary integration point for client applications. It accepts conversation turns for safety scoring and returns immediately with an `accepted` status. Scoring, threshold evaluation, and action execution happen asynchronously.

## Base URL

```
https://your-deployment.example.com/api/v1
```

## Authentication

All requests must include a valid API key in the `X-API-Key` header.

API keys are provisioned per-client via the SentinelArc dashboard. Each key is scoped to a single client (tenant) and carries rate limit metadata.

```
X-API-Key: sa_live_YOUR_API_KEY_HERE
```

## Endpoints

### POST /ingest

Submit a conversation turn for safety scoring.

**Headers:**

| Header      | Required | Description              |
|-------------|----------|--------------------------|
| X-API-Key   | Yes      | Client API key           |
| Content-Type| Yes      | Must be `application/json` |

**Request Body:**

```json
{
  "conversation_id": "conv_abc123",
  "end_user_id": "user_789",
  "turn": {
    "role": "user",
    "content": "Message content from the end user or companion",
    "timestamp": "2024-01-15T10:30:00Z",
    "metadata": {
      "session_id": "sess_456",
      "platform": "ios"
    }
  }
}
```

**Field Reference:**

| Field             | Type   | Required | Constraints                         | Description                          |
|-------------------|--------|----------|-------------------------------------|--------------------------------------|
| conversation_id   | string | Yes      | 1-255 chars                         | Your external conversation identifier |
| end_user_id       | string | Yes      | 1-255 chars                         | Your external user identifier         |
| turn.role         | enum   | Yes      | `"user"` or `"companion"`           | Who sent this message                 |
| turn.content      | string | Yes      | 1-50,000 chars                      | The message text                      |
| turn.timestamp    | string | Yes      | ISO 8601 datetime                   | When the message was sent             |
| turn.metadata     | object | No       | Arbitrary key-value pairs           | Optional context for scoring          |

### Response Codes

#### 202 Accepted

Turn was accepted and queued for scoring.

```json
{
  "turn_id": "clx1234567890",
  "conversation_id": "clx0987654321",
  "status": "accepted"
}
```

**Response Headers:**

| Header               | Description                                     |
|----------------------|-------------------------------------------------|
| X-RateLimit-Limit    | Maximum requests per window                     |
| X-RateLimit-Remaining| Remaining requests in current window            |
| X-RateLimit-Reset    | Unix timestamp when the window resets           |

#### 400 Bad Request

Invalid JSON body.

```json
{
  "error": "Invalid JSON body"
}
```

#### 401 Unauthorized

Missing or invalid API key.

```json
{
  "error": "Invalid or missing API key"
}
```

#### 422 Unprocessable Entity

Request body fails schema validation.

```json
{
  "error": "Validation failed",
  "details": [
    {
      "path": "turn.content",
      "message": "String must contain at least 1 character(s)"
    }
  ]
}
```

#### 429 Too Many Requests

Rate limit exceeded.

```json
{
  "error": "Rate limit exceeded",
  "retry_after": 60
}
```

## Rate Limits

| Plan       | Requests/hour | Burst (per second) |
|------------|---------------|---------------------|
| Starter    | 1,000         | 10                  |
| Growth     | 10,000        | 50                  |
| Enterprise | 100,000       | 200                 |

Rate limits are enforced per API key. When exceeded, the API returns `429` with a `Retry-After` header.

## Webhook Callbacks

When an action is taken on a conversation (block, crisis route), SentinelArc sends a webhook notification to your configured endpoint.

**Webhook Payload (HARD_BLOCK):**

```json
{
  "event": "action.hard_block",
  "timestamp": "2024-01-15T10:30:05Z",
  "data": {
    "conversation_id": "conv_abc123",
    "turn_id": "clx1234567890",
    "action": "HARD_BLOCK",
    "category": "violence",
    "score": 0.92,
    "reason": "Content exceeds safety threshold for violence category"
  }
}
```

**Webhook Payload (CRISIS_ROUTE):**

```json
{
  "event": "action.crisis_route",
  "timestamp": "2024-01-15T10:30:02Z",
  "data": {
    "conversation_id": "conv_abc123",
    "turn_id": "clx1234567890",
    "action": "CRISIS_ROUTE",
    "category": "self_harm",
    "score": 0.95,
    "resources_shown": true,
    "latency_ms": 3.2
  }
}
```

**Webhook Headers:**

| Header                    | Description                        |
|---------------------------|------------------------------------|
| X-SentinelArc-Signature  | HMAC-SHA256 signature for verification |
| X-SentinelArc-Timestamp  | Event timestamp for replay protection  |

## Example: cURL

```bash
curl -X POST https://your-deployment.example.com/api/v1/ingest \
  -H "Content-Type: application/json" \
  -H "X-API-Key: sa_live_YOUR_API_KEY_HERE" \
  -d '{
    "conversation_id": "conv_abc123",
    "end_user_id": "user_789",
    "turn": {
      "role": "user",
      "content": "Hello, how are you today?",
      "timestamp": "2024-01-15T10:30:00Z"
    }
  }'
```

## Example: Python

```python
import requests

API_KEY = "sa_live_YOUR_API_KEY_HERE"
BASE_URL = "https://your-deployment.example.com/api/v1"

def ingest_turn(conversation_id: str, user_id: str, content: str, role: str = "user"):
    """Send a conversation turn for safety scoring."""
    response = requests.post(
        f"{BASE_URL}/ingest",
        headers={
            "X-API-Key": API_KEY,
            "Content-Type": "application/json",
        },
        json={
            "conversation_id": conversation_id,
            "end_user_id": user_id,
            "turn": {
                "role": role,
                "content": content,
                "timestamp": "2024-01-15T10:30:00Z",
            },
        },
    )

    if response.status_code == 202:
        data = response.json()
        print(f"Accepted: turn_id={data['turn_id']}")
        return data
    else:
        print(f"Error {response.status_code}: {response.json()}")
        return None


# Usage
ingest_turn("conv_123", "user_456", "How are you feeling today?")
```

## Example: Node.js (TypeScript)

```typescript
const API_KEY = "sa_live_YOUR_API_KEY_HERE";
const BASE_URL = "https://your-deployment.example.com/api/v1";

interface IngestResponse {
  turn_id: string;
  conversation_id: string;
  status: string;
}

async function ingestTurn(
  conversationId: string,
  userId: string,
  content: string,
  role: "user" | "companion" = "user"
): Promise<IngestResponse | null> {
  const response = await fetch(`${BASE_URL}/ingest`, {
    method: "POST",
    headers: {
      "X-API-Key": API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      conversation_id: conversationId,
      end_user_id: userId,
      turn: {
        role,
        content,
        timestamp: new Date().toISOString(),
      },
    }),
  });

  if (response.status === 202) {
    const data: IngestResponse = await response.json();
    console.log(`Accepted: turn_id=${data.turn_id}`);
    return data;
  } else {
    const error = await response.json();
    console.error(`Error ${response.status}:`, error);
    return null;
  }
}

// Usage
await ingestTurn("conv_123", "user_456", "How are you feeling today?");
```

## Async Processing Flow

After ingestion:

1. The turn is queued for scoring via BullMQ
2. The scoring worker runs turn-level and (when applicable) arc-level analysis
3. Threshold evaluation determines if action is needed
4. If an action fires (SOFT_FLAG, HARD_BLOCK, CRISIS_ROUTE), the configured webhook receives a callback
5. Crisis routing fires immediately via a fast-path - it does not wait for the normal queue

**Typical latencies:**

| Stage            | p50    | p99    |
|------------------|--------|--------|
| Ingestion API    | 15ms   | 50ms   |
| Queue + Scoring  | 100ms  | 500ms  |
| Crisis Fast-Path | 2ms    | 5ms    |
| Webhook Delivery | 200ms  | 1000ms |
