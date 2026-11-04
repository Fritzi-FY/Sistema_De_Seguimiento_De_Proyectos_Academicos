

create table "public"."auth_user" ("id" uuid default pg_catalog.gen_random_uuid() not null primary key, "name" text not null, "email" text not null unique, "emailVerified" boolean not null, "image" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null);

create table "public"."auth_session" ("id" uuid default pg_catalog.gen_random_uuid() not null primary key, "expiresAt" timestamptz not null, "token" text not null unique, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null, "ipAddress" text, "userAgent" text, "userId" uuid not null references "public"."auth_user" ("id") on delete cascade);

create table "public"."auth_account" ("id" uuid default pg_catalog.gen_random_uuid() not null primary key, "accountId" text not null, "providerId" text not null, "userId" uuid not null references "public"."auth_user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz, "scope" text, "password" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null);

create table "public"."auth_verification" ("id" uuid default pg_catalog.gen_random_uuid() not null primary key, "identifier" text not null, "value" text not null, "expiresAt" timestamptz not null, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null);

create table "public"."auth_rate_limit" ("id" uuid default pg_catalog.gen_random_uuid() not null primary key, "key" text not null unique, "count" integer not null, "lastRequest" bigint not null);

create index "auth_session_userId_idx" on "public"."auth_session" ("userId");

create index "auth_account_userId_idx" on "public"."auth_account" ("userId");

create index "auth_verification_identifier_idx" on "public"."auth_verification" ("identifier");
CREATE TABLE public.auth_role_grants (user_id uuid PRIMARY KEY REFERENCES public.auth_user(id), role text NOT NULL CHECK(role IN ('student','teacher','admin')), active boolean NOT NULL, granted_by text NOT NULL);
CREATE TABLE public.auth_local_mail (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL, url text NOT NULL);

CREATE TABLE public.auth_verification_consumptions (token_hash text PRIMARY KEY, consumed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP);
