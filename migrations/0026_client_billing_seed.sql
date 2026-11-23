-- Client Billing seed: the 12 reporting clients with default projects,
-- contact mappings, chart-of-accounts categories, FY2027 periods.
-- Names/treatments per the Client Billing & Cost Allocation spec (23 Nov 2026).

-- ---- Clients (sort order = report order; General Sales last) --------------
INSERT INTO clients (id, name, short_name, is_general, sort_order) VALUES
  ('cl-abf',        'ABF Sugar Pty Ltd',                     'ABF Sugar',      0, 1),
  ('cl-sas',        'SAS Atlantique Signarama',              'SAS Atlantique', 0, 2),
  ('cl-axiomatic',  'Axiomatic Consultants (Pty) Ltd',       'Axiomatic',      0, 3),
  ('cl-scuderia',   'Scuderia Capital (Pty) Ltd',            'Scuderia',       0, 4),
  ('cl-bfg',        'Business Franchise Group Ltd',          'BFG',            0, 5),
  ('cl-devco',      'Devco Auctioneers and Sales (Pty) Ltd', 'Devco',          0, 6),
  ('cl-carlton',    'Carlton Solutions Ltd',                 'Carlton',        0, 7),
  ('cl-provantage', 'Provantage (Pty) Ltd',                  'Provantage',     0, 8),
  ('cl-gbs',        'Global Business Solutions',             'GBS',            0, 9),
  ('cl-eaw',        'Energy at Work Projects (Pty) Ltd',     'Energy at Work', 0, 10),
  ('cl-clicknhire', 'CLICKNHIRE (PTY) LTD',                  'ClicknHire',     0, 11),
  ('cl-general',    'General Sales',                         'General',        1, 99);

-- ---- One default project per client ---------------------------------------
INSERT INTO projects (id, client_id, name, is_default) VALUES
  ('pr-abf',        'cl-abf',        'ABF Sugar Pty Ltd',                     1),
  ('pr-sas',        'cl-sas',        'SAS Atlantique Signarama',              1),
  ('pr-axiomatic',  'cl-axiomatic',  'Axiomatic Consultants (Pty) Ltd',       1),
  ('pr-scuderia',   'cl-scuderia',   'Scuderia Capital (Pty) Ltd',            1),
  ('pr-bfg',        'cl-bfg',        'Business Franchise Group Ltd',          1),
  ('pr-devco',      'cl-devco',      'Devco Auctioneers and Sales (Pty) Ltd', 1),
  ('pr-carlton',    'cl-carlton',    'Carlton Solutions Ltd',                 1),
  ('pr-provantage', 'cl-provantage', 'Provantage (Pty) Ltd',                  1),
  ('pr-gbs',        'cl-gbs',        'Global Business Solutions',             1),
  ('pr-eaw',        'cl-eaw',        'Energy at Work Projects (Pty) Ltd',     1),
  ('pr-clicknhire', 'cl-clicknhire', 'CLICKNHIRE (PTY) LTD',                  1),
  ('pr-general',    'cl-general',    'General Sales',                         1);

-- ---- Xero contact name -> reporting client --------------------------------
-- Fortune-Wes / Signarama Cote d'Ivoire rolls into Scuderia Capital.
INSERT INTO client_contacts (id, client_id, contact_name) VALUES
  ('cc-abf',        'cl-abf',        'ABF Sugar Pty Ltd'),
  ('cc-sas',        'cl-sas',        'SAS ATLANTIQUE SIGNARAMA'),
  ('cc-axiomatic',  'cl-axiomatic',  'Axiomatic Consultants (Pty) Ltd'),
  ('cc-scuderia',   'cl-scuderia',   'Scuderia Capital (Pty) Ltd'),
  ('cc-fortunewes', 'cl-scuderia',   'Fortune-Wes / Signarama Côte d''Ivoire'),
  ('cc-bfg',        'cl-bfg',        'Business Franchise Group Ltd'),
  ('cc-devco',      'cl-devco',      'Devco Auctioneers and Sales (Pty) Ltd'),
  ('cc-carlton',    'cl-carlton',    'Carlton Solutions Ltd'),
  ('cc-provantage', 'cl-provantage', 'Provantage (Pty) Ltd'),
  ('cc-gbs',        'cl-gbs',        'Global Business Solutions'),
  ('cc-eaw',        'cl-eaw',        'Energy at Work Projects (Pty) Ltd'),
  ('cc-clicknhire', 'cl-clicknhire', 'CLICKNHIRE (PTY) LTD');

-- ---- Chart of accounts: report group + treatment per code ------------------
-- Names are placeholders ('') until the sync fills them from GET /Accounts.
-- Revenue
INSERT INTO gl_categories (code, name, kind, report_group, treatment, sort_order) VALUES
  ('203', '', 'revenue', 'Projects / Development', 'revenue', 10),
  ('207', '', 'revenue', 'Projects / Development', 'revenue', 10),
  ('210', '', 'revenue', 'Projects / Development', 'revenue', 10),
  ('216', '', 'revenue', 'Projects / Development', 'revenue', 10),
  ('225', '', 'revenue', 'Projects / Development', 'revenue', 10),
  ('202', '', 'revenue', 'Managed services / Retainers', 'revenue', 20),
  ('208', '', 'revenue', 'Managed services / Retainers', 'revenue', 20),
  ('209', '', 'revenue', 'Managed services / Retainers', 'revenue', 20),
  ('213', '', 'revenue', 'Managed services / Retainers', 'revenue', 20),
  ('218', '', 'revenue', 'Managed services / Retainers', 'revenue', 20),
  ('223', '', 'revenue', 'Managed services / Retainers', 'revenue', 20),
  ('224', '', 'revenue', 'Managed services / Retainers', 'revenue', 20),
  ('201', '', 'revenue', 'Hosting & Domains', 'revenue', 30),
  ('204', '', 'revenue', 'Hosting & Domains', 'revenue', 30),
  ('205', '', 'revenue', 'Hosting & Domains', 'revenue', 30),
  ('206', '', 'revenue', 'Hosting & Domains', 'revenue', 30),
  ('214', '', 'revenue', 'Hosting & Domains', 'revenue', 30),
  ('215', '', 'revenue', 'Hosting & Domains', 'revenue', 30),
  ('222', '', 'revenue', 'Hosting & Domains', 'revenue', 30),
  ('211', '', 'revenue', 'Marketing', 'revenue', 40),
  ('212', '', 'revenue', 'Marketing', 'revenue', 40),
  ('217', '', 'revenue', 'Marketing', 'revenue', 40),
  ('219', '', 'revenue', 'Marketing', 'revenue', 40),
  ('220',      '', 'revenue', 'Other income', 'excluded', 50),
  ('221',      '', 'revenue', 'Other income', 'excluded', 50),
  ('0123',     '', 'revenue', 'Other income', 'excluded', 50),
  ('17015971', '', 'revenue', 'Other income', 'excluded', 50);
-- Costs
INSERT INTO gl_categories (code, name, kind, report_group, treatment, sort_order) VALUES
  ('316', '', 'cost', 'People', 'people', 110),
  ('312', '', 'cost', 'People', 'people', 110),
  ('428', '', 'cost', 'People', 'people', 110),
  ('310', '', 'cost', 'Contractors & Bonuses', 'direct', 120),
  ('311', '', 'cost', 'Contractors & Bonuses', 'direct', 120),
  ('412', '', 'cost', 'Contractors & Bonuses', 'direct', 120),
  ('315', '', 'cost', 'Hosting & Infra', 'direct', 130),
  ('313', '', 'cost', 'Hosting & Infra', 'direct', 130),
  ('314', '', 'cost', 'Client marketing', 'direct', 140),
  ('406', '', 'cost', 'Software & Licences', 'overhead', 150),
  ('440', '', 'cost', 'Software & Licences', 'overhead', 150),
  ('455', '', 'cost', 'Software & Licences', 'overhead', 150),
  ('446', '', 'cost', 'Sundries', 'overhead', 160),
  ('447', '', 'cost', 'Sundries', 'overhead', 160),
  ('448', '', 'cost', 'Sundries', 'overhead', 160),
  ('449', '', 'cost', 'Sundries', 'overhead', 160),
  ('413', 'Directors Salaries', 'cost', 'Running costs', 'overhead', 170),
  ('435', '', 'cost', 'Running costs', 'overhead', 170),
  ('17015949', '', 'cost', 'Finance & non-operating', 'excluded', 180),
  ('416',      '', 'cost', 'Finance & non-operating', 'excluded', 180),
  ('437',      '', 'cost', 'Finance & non-operating', 'excluded', 180),
  ('453',      '', 'cost', 'Finance & non-operating', 'excluded', 180),
  ('415',      '', 'cost', 'Finance & non-operating', 'excluded', 180),
  ('17015970', '', 'cost', 'Unallocated expense', 'overhead', 190);

-- ---- FY2027 periods (Mar 2026 - Feb 2027), overhead basis = revenue share --
INSERT INTO billing_periods (period) VALUES
  ('2026-03'), ('2026-04'), ('2026-05'), ('2026-06'), ('2026-07'), ('2026-08'),
  ('2026-09'), ('2026-10'), ('2026-11'), ('2026-12'), ('2027-01'), ('2027-02');

-- ---- Director time: all overhead (KJ Banks excluded from the share grid) ---
UPDATE employees SET default_target = 'overhead' WHERE name LIKE '%Banks%';

UPDATE app_meta SET value = '26' WHERE key = 'schema_version';
