import { relations } from "drizzle-orm";
import { pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const dataRegion = pgEnum("data_region", [
  "eu-central-1",
  "eu-west-1",
  "us-east-1",
  "ap-south-1"
]);

export const membershipRole = pgEnum("membership_role", [
  "owner",
  "admin",
  "manager",
  "member",
  "guest"
]);

export const meetingStatus = pgEnum("meeting_status", [
  "scheduled",
  "dispatching",
  "joining",
  "waiting_room",
  "recording",
  "leaving",
  "processing",
  "ready",
  "failed",
  "cancelled"
]);

export const consentPolicy = pgEnum("consent_policy", [
  "implicit",
  "announce",
  "explicit_opt_in"
]);

export const organizations = pgTable(
  "organizations",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    dataRegion: dataRegion("data_region").notNull().default("eu-central-1"),
    consentPolicy: consentPolicy("consent_policy").notNull().default("announce"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true })
  },
  (table) => [uniqueIndex("organizations_slug_idx").on(table.slug)]
);

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true })
  },
  (table) => [uniqueIndex("users_email_idx").on(table.email)]
);

export const memberships = pgTable(
  "memberships",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    role: membershipRole("role").notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true })
  },
  (table) => [
    uniqueIndex("memberships_organization_user_idx").on(
      table.organizationId,
      table.userId
    )
  ]
);

export const meetings = pgTable("meetings", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id),
  title: text("title").notNull(),
  status: meetingStatus("status").notNull().default("scheduled"),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  conferenceUrlHash: text("conference_url_hash"),
  createdByUserId: text("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true })
});

export const organizationRelations = relations(organizations, ({ many }) => ({
  memberships: many(memberships),
  meetings: many(meetings)
}));

export const userRelations = relations(users, ({ many }) => ({
  memberships: many(memberships),
  createdMeetings: many(meetings)
}));

export const membershipRelations = relations(memberships, ({ one }) => ({
  organization: one(organizations, {
    fields: [memberships.organizationId],
    references: [organizations.id]
  }),
  user: one(users, {
    fields: [memberships.userId],
    references: [users.id]
  })
}));

export const meetingRelations = relations(meetings, ({ one }) => ({
  organization: one(organizations, {
    fields: [meetings.organizationId],
    references: [organizations.id]
  }),
  createdBy: one(users, {
    fields: [meetings.createdByUserId],
    references: [users.id]
  })
}));

