ALTER TABLE tattoo_settings
  ADD COLUMN inquiry_budget_ranges_json TEXT NOT NULL DEFAULT '[{"minimumDollars":null,"maximumDollars":300},{"minimumDollars":300,"maximumDollars":500},{"minimumDollars":500,"maximumDollars":800},{"minimumDollars":800,"maximumDollars":1200},{"minimumDollars":1200,"maximumDollars":2000},{"minimumDollars":2000,"maximumDollars":null}]';
