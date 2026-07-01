"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface ConversationSummary {
  id: string;
  externalId: string;
  endUserId: string;
  startedAt: string;
  lastActiveAt: string;
  _count: { turns: number };
}

export default function ConversationsPage() {
  const [conversations, setConversations] = React.useState<
    ConversationSummary[]
  >([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    async function fetchConversations() {
      try {
        const response = await fetch("/api/v1/conversations");
        if (!response.ok) {
          throw new Error("Failed to fetch conversations");
        }
        const data = await response.json();
        setConversations(data.conversations);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    }
    fetchConversations();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Conversations</h1>
        <p className="text-muted-foreground">
          Monitored conversations for your organization (most recent first)
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center p-8">
              <span className="text-muted-foreground">Loading...</span>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center p-8">
              <span className="text-destructive">{error}</span>
            </div>
          ) : conversations.length === 0 ? (
            <div className="flex items-center justify-center p-8">
              <span className="text-muted-foreground">
                No conversations found
              </span>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>External ID</TableHead>
                  <TableHead>End User</TableHead>
                  <TableHead>Turns</TableHead>
                  <TableHead>Last Active</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {conversations.map((conversation) => (
                  <TableRow key={conversation.id}>
                    <TableCell className="font-mono text-xs">
                      {conversation.externalId}
                    </TableCell>
                    <TableCell className="font-medium">
                      {conversation.endUserId}
                    </TableCell>
                    <TableCell>{conversation._count.turns}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(conversation.lastActiveAt).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Link href={`/conversations/${conversation.id}`}>
                        <Button size="sm" variant="outline">
                          View
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
