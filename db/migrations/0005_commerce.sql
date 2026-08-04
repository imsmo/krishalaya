-- ============================================================================
-- MIGRATION 0005 — COMMERCE
-- Source of truth: Database_Architecture/full_platform/04_commerce.sql (reproduced verbatim)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it
-- in schema_migrations. NEVER edit an applied migration — add a new numbered one.
-- ============================================================================

-- ============================================================================
-- FILE 04 — COMMERCE: LISTINGS, GROUP LOTS, REQUIREMENTS, AUCTIONS, CARTS,
--           ORDERS (multi-item), DISPUTES, RETURNS, REVIEWS, OFFERS
-- Modules: M03 Listing, M04 Bidding, M06 Orders, M08 Reviews, M12 Requirements
-- ============================================================================

CREATE TYPE listing_status  AS ENUM ('draft','pending_approval','published','paused','sold_out','expired','rejected','hidden','archived');
CREATE TYPE sale_type       AS ENUM ('direct','auction','both','preorder','service','group_lot');
CREATE TYPE auction_kind    AS ENUM ('english_open','sealed','reverse','dutch');
CREATE TYPE auction_status  AS ENUM ('scheduled','live','extended','ended','awaiting_approval','settled','cancelled','failed_reserve');
CREATE TYPE order_status    AS ENUM ('created','payment_pending','confirmed','packed','ready','picked_up','in_transit','out_for_delivery','delivered','completed','cancelled','disputed','refunded','partially_refunded','partially_fulfilled');
CREATE TYPE dispute_status  AS ENUM ('open','seller_responded','under_review','escalated','resolved','rejected','withdrawn');
CREATE TYPE requirement_status AS ENUM ('open','partially_matched','fulfilled','expired','closed');

-- ---------- listings (the offer)
CREATE TABLE listings (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  seller_user_id  uuid NOT NULL REFERENCES users(id),
  product_id      uuid NOT NULL REFERENCES products(id),
  category_id     uuid NOT NULL REFERENCES categories(id),  -- denormalised for hot filters
  title           varchar(250) NOT NULL,
  description     text,
  quantity_total  numeric(14,3) NOT NULL CHECK (quantity_total > 0),
  quantity_available numeric(14,3) NOT NULL,
  min_order_qty   numeric(14,3) NOT NULL DEFAULT 0,
  unit_code       varchar(20) NOT NULL REFERENCES units(code),
  price_minor     bigint NOT NULL CHECK (price_minor > 0),
  currency_code   char(3) NOT NULL DEFAULT 'INR' REFERENCES currencies(code),
  batch_id        uuid REFERENCES product_batches(id), -- regulated inputs sell FIFO from batches
  sale_type       sale_type NOT NULL DEFAULT 'direct',
  status          listing_status NOT NULL DEFAULT 'draft',
  harvest_date    date,
  organic_claim   varchar(20),                        -- none|natural|certified (cert via certificates table)
  grade_option_id uuid REFERENCES attribute_options(id),
  ai_grade_option_id uuid REFERENCES attribute_options(id), -- AI photo grading suggestion
  ai_grade_confidence numeric(5,4),
  ai_extracted    boolean NOT NULL DEFAULT false,
  ai_meta         jsonb NOT NULL DEFAULT '{}',
  address_id      uuid REFERENCES addresses(id),
  pincode         varchar(10),
  region_id       uuid REFERENCES admin_regions(id),
  lat             numeric(9,6),
  lng             numeric(9,6),
  visibility      varchar(20) NOT NULL DEFAULT 'tenant',   -- tenant|cross_tenant|public (PRD §9.3 + federation)
  publish_at      timestamptz,
  published_at    timestamptz,
  expires_at      timestamptz,
  reject_reason   text,
  group_lot_id    uuid,                               -- FK after group_lots
  version         integer NOT NULL DEFAULT 1
);
CALL add_std_columns('listings');
CREATE INDEX idx_listings_tenant_status ON listings(tenant_id, status, published_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_listings_seller ON listings(seller_user_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_listings_browse ON listings(category_id, status, pincode) WHERE status='published' AND deleted_at IS NULL;
CREATE INDEX idx_listings_product ON listings(product_id) WHERE status='published';

CREATE TABLE listing_attribute_values (               -- listing-level dynamic attrs (moisture of THIS lot)
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  listing_id   uuid NOT NULL REFERENCES listings(id),
  attribute_id uuid NOT NULL REFERENCES attribute_definitions(id),
  value_text   text,
  value_number numeric(20,6),
  value_bool   boolean,
  value_date   date,
  option_id    uuid REFERENCES attribute_options(id),
  UNIQUE (listing_id, attribute_id)
);
CREATE INDEX idx_lav_listing ON listing_attribute_values(listing_id);
CREATE INDEX idx_lav_filter ON listing_attribute_values(attribute_id, option_id);

CREATE TABLE listing_price_history (                  -- price-change audit + buyer alerts
  id           uuid NOT NULL DEFAULT uuid_generate_v7(),
  listing_id   uuid NOT NULL,
  tenant_id    uuid NOT NULL,
  old_price_minor bigint,
  new_price_minor bigint NOT NULL,
  changed_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
CREATE INDEX idx_lph_listing ON listing_price_history(listing_id, created_at DESC);

-- ---------- group lots (FPO pooling — PRD §7.7 signature)
CREATE TABLE group_lots (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  coordinator_user_id uuid NOT NULL REFERENCES users(id),
  product_id      uuid NOT NULL REFERENCES products(id),
  target_quantity numeric(14,3) NOT NULL,
  pledged_quantity numeric(14,3) NOT NULL DEFAULT 0,
  unit_code       varchar(20) NOT NULL REFERENCES units(code),
  pledge_deadline timestamptz NOT NULL,
  status          varchar(20) NOT NULL DEFAULT 'pledging',  -- pledging|ready|listed|sold|settled|cancelled
  coordination_fee_bps integer NOT NULL DEFAULT 0     -- coordinator fee in basis points
);
CALL add_std_columns('group_lots');
ALTER TABLE listings ADD CONSTRAINT fk_listings_group_lot FOREIGN KEY (group_lot_id) REFERENCES group_lots(id);

CREATE TABLE group_lot_pledges (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  group_lot_id  uuid NOT NULL REFERENCES group_lots(id),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  farmer_user_id uuid NOT NULL REFERENCES users(id),
  quantity      numeric(14,3) NOT NULL CHECK (quantity > 0),
  quality_ok    boolean,                              -- AI consistency check flag (PRD §7.7)
  settled_share_minor bigint,                         -- proportional payout after sale
  UNIQUE (group_lot_id, farmer_user_id)
);
CALL add_std_columns('group_lot_pledges');

-- ---------- requirements / demand (M12)
CREATE TABLE requirements (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  buyer_user_id  uuid NOT NULL REFERENCES users(id),
  product_id     uuid REFERENCES products(id),
  category_id    uuid REFERENCES categories(id),
  title          varchar(250) NOT NULL,
  quantity       numeric(14,3) NOT NULL,
  unit_code      varchar(20) NOT NULL REFERENCES units(code),
  budget_min_minor bigint,
  budget_max_minor bigint,
  currency_code  char(3) NOT NULL DEFAULT 'INR',
  need_by        date,
  delivery_pincode varchar(10),
  status         requirement_status NOT NULL DEFAULT 'open',
  is_urgent      boolean NOT NULL DEFAULT false
);
CALL add_std_columns('requirements');
CREATE INDEX idx_requirements_open ON requirements(tenant_id, category_id) WHERE status='open';

CREATE TABLE requirement_responses (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  requirement_id uuid NOT NULL REFERENCES requirements(id),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  seller_user_id uuid NOT NULL REFERENCES users(id),
  listing_id     uuid REFERENCES listings(id),
  quoted_price_minor bigint NOT NULL,
  quantity       numeric(14,3) NOT NULL,
  valid_until    timestamptz,
  message        text,
  status         varchar(20) NOT NULL DEFAULT 'submitted', -- submitted|shortlisted|accepted|rejected|expired
  ai_match_score numeric(5,4),
  UNIQUE (requirement_id, seller_user_id)
);
CALL add_std_columns('requirement_responses');

-- ---------- auctions (M04: 4 kinds per PRD §9.4)
CREATE TABLE auctions (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  listing_id        uuid NOT NULL UNIQUE REFERENCES listings(id),
  kind              auction_kind NOT NULL DEFAULT 'english_open',
  start_price_minor bigint NOT NULL CHECK (start_price_minor > 0),
  reserve_price_minor bigint,
  min_increment_minor bigint NOT NULL DEFAULT 10000,
  emd_minor         bigint NOT NULL DEFAULT 0,
  emd_pct_bps       integer,                          -- alternative: EMD as % of bid
  starts_at         timestamptz NOT NULL,
  ends_at           timestamptz NOT NULL,
  auto_extend_secs  integer NOT NULL DEFAULT 120,
  extend_trigger_secs integer NOT NULL DEFAULT 60,
  min_bidders       smallint,
  requires_seller_approval boolean NOT NULL DEFAULT false,
  bidder_qualification jsonb NOT NULL DEFAULT '{}',   -- {roles:[],regions:[],kyc:'verified'}
  status            auction_status NOT NULL DEFAULT 'scheduled',
  winning_bid_id    uuid,
  settled_order_id  uuid,
  version           integer NOT NULL DEFAULT 1
);
CALL add_std_columns('auctions');
CREATE INDEX idx_auctions_live ON auctions(ends_at) WHERE status IN ('live','extended');
CREATE INDEX idx_auctions_tenant ON auctions(tenant_id, status);

CREATE TABLE bids (                                   -- IMMUTABLE (grants in file 13)
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  auction_id     uuid NOT NULL REFERENCES auctions(id),
  bidder_user_id uuid NOT NULL REFERENCES users(id),
  amount_minor   bigint NOT NULL CHECK (amount_minor > 0),
  is_sealed      boolean NOT NULL DEFAULT false,
  emd_txn_id     uuid,                                -- ledger hold
  ip             inet,
  device_fingerprint varchar(200),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_bids_auction ON bids(auction_id, amount_minor DESC);
CREATE INDEX idx_bids_bidder ON bids(bidder_user_id, created_at DESC);
ALTER TABLE auctions ADD CONSTRAINT fk_auction_winning_bid FOREIGN KEY (winning_bid_id) REFERENCES bids(id);

CREATE TABLE auction_events (                         -- lifecycle audit: started|extended|flagged|ended
  id          uuid NOT NULL DEFAULT uuid_generate_v7(),
  auction_id  uuid NOT NULL,
  tenant_id   uuid NOT NULL,
  event_code  varchar(40) NOT NULL,
  meta        jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
CREATE INDEX idx_auction_events ON auction_events(auction_id, created_at);

CREATE TABLE auction_watchers (
  auction_id uuid NOT NULL REFERENCES auctions(id),
  user_id    uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (auction_id, user_id)
);

-- ---------- carts (multi-vendor, Phase 2 — PRD §9.6)
CREATE TABLE carts (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id),
  user_id    uuid NOT NULL REFERENCES users(id),
  status     varchar(15) NOT NULL DEFAULT 'active' CHECK (status IN ('active','converted','abandoned')),
  UNIQUE (tenant_id, user_id, status)
);
CALL add_std_columns('carts');

CREATE TABLE cart_items (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  cart_id     uuid NOT NULL REFERENCES carts(id),
  listing_id  uuid NOT NULL REFERENCES listings(id),
  quantity    numeric(14,3) NOT NULL CHECK (quantity > 0),
  added_price_minor bigint NOT NULL,                  -- price when added (drift detection)
  UNIQUE (cart_id, listing_id)
);
CALL add_std_columns('cart_items');

-- ---------- orders: header + ITEMS (multi-vendor split = one order per seller,
-- many items; checkout group links sibling orders)
CREATE TABLE checkout_groups (                        -- one payment, many sub-orders
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  buyer_user_id uuid NOT NULL REFERENCES users(id),
  total_minor   bigint NOT NULL,
  currency_code char(3) NOT NULL DEFAULT 'INR',
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE orders (
  id              uuid NOT NULL DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL,
  order_no        varchar(40) NOT NULL,               -- human-facing via next_doc_number()
  checkout_group_id uuid,
  buyer_user_id   uuid NOT NULL,
  seller_user_id  uuid NOT NULL,
  source          varchar(20) NOT NULL DEFAULT 'direct',   -- direct|auction|requirement|subscription|group_lot|pos
  auction_id      uuid,
  requirement_id  uuid,
  currency_code   char(3) NOT NULL DEFAULT 'INR',
  subtotal_minor  bigint NOT NULL,
  delivery_fee_minor bigint NOT NULL DEFAULT 0,
  discount_minor  bigint NOT NULL DEFAULT 0,
  tax_minor       bigint NOT NULL DEFAULT 0,
  commission_minor bigint NOT NULL DEFAULT 0,         -- tenant commission (rule snapshot below)
  platform_fee_minor bigint NOT NULL DEFAULT 0,       -- Krishi-Verse override share
  tds_minor       bigint NOT NULL DEFAULT 0,
  total_minor     bigint NOT NULL,
  commission_rule_snapshot jsonb,                     -- exact rule applied (auditable forever)
  status          order_status NOT NULL DEFAULT 'created',
  delivery_method_id uuid,                            -- lookup 'delivery_method': self_pickup|seller_delivery|tenant_delivery|3pl
  shipment_id     uuid,                               -- file 06
  delivery_address_id uuid,
  delivery_otp_hash varchar(128),
  acceptance_deadline timestamptz,                    -- seller confirm window (PRD §7.4)
  quality_window_ends timestamptz,                    -- dispute window (24h/6h perishable)
  cancel_reason_id uuid,
  cancelled_by    uuid,
  version         integer NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
CREATE TRIGGER orders_uat BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE UNIQUE INDEX uq_orders_no ON orders(tenant_id, order_no, created_at);
CREATE INDEX idx_orders_tenant_status ON orders(tenant_id, status, created_at DESC);
CREATE INDEX idx_orders_buyer ON orders(buyer_user_id, created_at DESC);
CREATE INDEX idx_orders_seller ON orders(seller_user_id, created_at DESC);

CREATE TABLE order_items (
  id            uuid NOT NULL DEFAULT uuid_generate_v7(),
  order_id      uuid NOT NULL,
  order_created_at timestamptz NOT NULL,              -- locate parent partition
  tenant_id     uuid NOT NULL,
  listing_id    uuid NOT NULL,
  product_id    uuid NOT NULL,
  title_snapshot varchar(250) NOT NULL,               -- what buyer saw, frozen
  quantity      numeric(14,3) NOT NULL,
  delivered_quantity numeric(14,3),                   -- partial fulfilment (PRD §9.6)
  unit_code     varchar(20) NOT NULL,
  unit_price_minor bigint NOT NULL,
  line_total_minor bigint NOT NULL,
  gst_rate_pct  numeric(5,2),
  hsn_code      varchar(12),
  batch_id      uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_items_listing ON order_items(listing_id);

CREATE TABLE order_events (
  id          uuid NOT NULL DEFAULT uuid_generate_v7(),
  tenant_id   uuid NOT NULL,
  order_id    uuid NOT NULL,
  from_status order_status,
  to_status   order_status NOT NULL,
  actor_user_id uuid,
  note        text,
  meta        jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
CREATE INDEX idx_order_events_order ON order_events(order_id, created_at);

-- ---------- disputes (PRD §13.3 — full workflow with evidence)
CREATE TABLE disputes (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  order_id       uuid NOT NULL,
  raised_by      uuid NOT NULL REFERENCES users(id),
  against_user   uuid NOT NULL REFERENCES users(id),
  reason_id      uuid NOT NULL REFERENCES lookup_values(id), -- lookup 'dispute_reason': not_delivered|poor_quality|qty_mismatch|late|wrong_item|damaged|payment|bid_manipulation|fake_certificate
  description    text,
  status         dispute_status NOT NULL DEFAULT 'open',
  seller_respond_by timestamptz,
  ai_triage      jsonb,                               -- {classification, recommended_action, confidence}
  resolution_type varchar(30),                        -- refund_full|refund_partial|replacement|rejected
  resolution_amount_minor bigint,
  resolution_txn_id uuid,                             -- ledger reversal txn
  resolved_by    uuid REFERENCES users(id),
  resolved_at    timestamptz,
  sla_due_at     timestamptz
);
CALL add_std_columns('disputes');
CREATE INDEX idx_disputes_tenant_open ON disputes(tenant_id, status) WHERE status NOT IN ('resolved','rejected','withdrawn');
CREATE INDEX idx_disputes_order ON disputes(order_id);

CREATE TABLE dispute_messages (                       -- threaded evidence/communication
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  dispute_id  uuid NOT NULL REFERENCES disputes(id),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  author_user_id uuid NOT NULL REFERENCES users(id),
  body        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_dispute_msgs ON dispute_messages(dispute_id, created_at);

CREATE TABLE returns (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  order_id    uuid NOT NULL,
  dispute_id  uuid REFERENCES disputes(id),
  status      varchar(20) NOT NULL DEFAULT 'requested', -- requested|approved|in_transit|received|refunded|rejected
  reason_id   uuid REFERENCES lookup_values(id),
  refund_txn_id uuid
);
CALL add_std_columns('returns');

-- ---------- reviews (multi-target per PRD §9.8: product/seller/buyer/delivery)
CREATE TABLE reviews (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  order_id        uuid,
  reviewer_user_id uuid NOT NULL REFERENCES users(id),
  target_type     varchar(30) NOT NULL,               -- 'seller','buyer','product','delivery_partner','course','worker','farmer_employer'
  target_id       uuid NOT NULL,
  stars           smallint NOT NULL CHECK (stars BETWEEN 1 AND 5),
  sub_ratings     jsonb NOT NULL DEFAULT '{}',        -- {quality:5, freshness:4, packaging:3} dynamic dimensions
  body            text,
  tags            jsonb NOT NULL DEFAULT '[]',
  is_verified_purchase boolean NOT NULL DEFAULT false,
  status          varchar(20) NOT NULL DEFAULT 'published', -- published|hidden|under_moderation|removed
  seller_response text,
  seller_responded_at timestamptz,
  helpful_count   integer NOT NULL DEFAULT 0,
  UNIQUE (order_id, reviewer_user_id, target_type, target_id)
);
CALL add_std_columns('reviews');
CREATE INDEX idx_reviews_target ON reviews(target_type, target_id) WHERE status='published';

-- ---------- offers, promotions, coupons (PRD §9.5 offers)
CREATE TABLE promotions (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  promo_type   varchar(30) NOT NULL,                  -- 'recharge_bonus','cashback','listing_boost','festival'
  default_name varchar(150) NOT NULL,
  rules        jsonb NOT NULL,                        -- {min_recharge_minor, bonus_pct, categories, max_uses_per_user}
  budget_minor bigint,
  spent_minor  bigint NOT NULL DEFAULT 0,
  starts_at    timestamptz NOT NULL,
  ends_at      timestamptz NOT NULL,
  is_active    boolean NOT NULL DEFAULT true
);
CALL add_std_columns('promotions');

CREATE TABLE coupons (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  promotion_id uuid REFERENCES promotions(id),
  code         varchar(40) NOT NULL,
  max_uses     integer,
  uses         integer NOT NULL DEFAULT 0,
  per_user_limit smallint NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, code)
);
CALL add_std_columns('coupons');

CREATE TABLE coupon_redemptions (
  id        uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  coupon_id uuid NOT NULL REFERENCES coupons(id),
  tenant_id uuid NOT NULL,
  user_id   uuid NOT NULL REFERENCES users(id),
  order_id  uuid,
  amount_minor bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (coupon_id, order_id)
);

CREATE TABLE listing_boosts (                         -- paid visibility (Revenue stream #4)
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  listing_id  uuid NOT NULL REFERENCES listings(id),
  buyer_user_id uuid NOT NULL REFERENCES users(id),
  boost_tier_id uuid NOT NULL REFERENCES lookup_values(id), -- lookup 'boost_tier': local|regional|statewide (price in meta)
  price_minor bigint NOT NULL,
  payment_txn_id uuid,
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL
);
CALL add_std_columns('listing_boosts');
CREATE INDEX idx_boosts_active ON listing_boosts(ends_at) WHERE deleted_at IS NULL;

