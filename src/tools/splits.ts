/**
 * Splitwise integration tools — create and manage expense splits.
 */

import type { FastMCP } from "fastmcp";
import { z } from "zod";
import { getUserId } from "../auth.js";
import { supabase } from "../db.js";

export function registerSplitTools(server: FastMCP) {
	server.addTool({
		name: "get-splitwise-status",
		description: "Check if the user's Splitwise account is connected.",
		annotations: { readOnlyHint: true },
		parameters: z.object({}),
		execute: async (_args, { session }) => {
			const userId = await getUserId(session);

			const { data } = await supabase
				.from("splitwise_connections")
				.select("splitwise_user_id")
				.eq("user_id", userId)
				.single();

			return JSON.stringify({
				connected: !!data,
				splitwiseUserId: data?.splitwise_user_id ? Number(data.splitwise_user_id) : null,
			});
		},
	});

	server.addTool({
		name: "get-splitwise-friends",
		description: "List the user's Splitwise friends.",
		annotations: { readOnlyHint: true },
		parameters: z.object({}),
		execute: async (_args, { session }) => {
			const userId = await getUserId(session);

			const { data, error } = await supabase
				.from("splitwise_friends")
				.select("id, first_name, last_name, email")
				.eq("user_id", userId)
				.order("first_name");

			if (error) throw new Error(`Failed to fetch friends: ${error.message}`);

			return JSON.stringify(
				(data ?? []).map((f) => ({
					id: Number(f.id),
					firstName: f.first_name,
					lastName: f.last_name,
					email: f.email,
				})),
				null,
				2,
			);
		},
	});

	server.addTool({
		name: "get-splitwise-groups",
		description: "List the user's Splitwise groups with members.",
		annotations: { readOnlyHint: true },
		parameters: z.object({}),
		execute: async (_args, { session }) => {
			const userId = await getUserId(session);

			const { data: groups, error } = await supabase
				.from("splitwise_groups")
				.select("id, name, splitwise_group_id")
				.eq("user_id", userId)
				.order("name");

			if (error) throw new Error(`Failed to fetch groups: ${error.message}`);

			// Get members for each group
			const groupIds = (groups ?? []).map((g) => g.id);
			const { data: members } = await supabase
				.from("splitwise_group_members")
				.select("group_id, friend_id")
				.eq("user_id", userId)
				.in("group_id", groupIds);

			const friendIds = [...new Set((members ?? []).map((m) => Number(m.friend_id)))];
			const { data: friends } = await supabase
				.from("splitwise_friends")
				.select("id, first_name, last_name, email")
				.eq("user_id", userId)
				.in("id", friendIds);

			const friendMap = new Map((friends ?? []).map((f) => [Number(f.id), f]));
			const membersByGroup = new Map<string, typeof friends>();
			for (const m of members ?? []) {
				const list = membersByGroup.get(m.group_id) ?? [];
				const friend = friendMap.get(Number(m.friend_id));
				if (friend) list.push(friend);
				membersByGroup.set(m.group_id, list);
			}

			return JSON.stringify(
				(groups ?? []).map((g) => ({
					id: Number(g.id),
					name: g.name,
					splitwiseGroupId: Number(g.splitwise_group_id),
					members: (membersByGroup.get(g.id) ?? []).map((f) => ({
						id: Number(f.id),
						firstName: f.first_name,
						lastName: f.last_name,
						email: f.email,
					})),
				})),
				null,
				2,
			);
		},
	});
}
