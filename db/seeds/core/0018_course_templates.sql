-- ==================================================================================================================
-- db/seeds/core/0018_course_templates.sql
-- PC-56 TENANT-7d · THE INSTRUCTOR — the platform's course TEMPLATES (W410 / W2775 "Start from template").
-- ==================================================================================================================
--
-- W410's empty state: *"Start from a template — outline, quiz and publish checklist already scaffolded."* Until 0173 no
-- template table existed and 7a named the button as refused. These are the platform's rows (tenant_id NULL — readable by
-- every tenant under course_templates' policy). The OUTLINE is the scaffold: each module becomes a module_no, each
-- lesson a DRAFT lesson of the named kind with no media and no body yet (a quiz lesson has no questions yet — W413's
-- chain adds them). The publish checklist is W416's gate, which every course has. Topic codes are `course_topic`
-- lookup codes (0005); the review refuses a template whose topic the registry no longer holds.
--
-- Re-runnable: ON CONFLICT on the partial unique index over (code) WHERE tenant_id IS NULL.
INSERT INTO course_templates (tenant_id, code, title, topic_code, level, outline, sort_order) VALUES
 (NULL, 'clean_milk', 'Clean Milk Production', 'safety', 'basic', '[
   {"title": "Why clean milk", "lessons": [{"title": "What spoils milk", "kind": "video"}, {"title": "The farmer''s five habits", "kind": "article"}]},
   {"title": "At the animal", "lessons": [{"title": "Udder hygiene before milking", "kind": "video"}, {"title": "Spotting mastitis early", "kind": "video"}, {"title": "Check yourself: udder care", "kind": "quiz"}]},
   {"title": "From the shed to the centre", "lessons": [{"title": "Cans, cooling and the two-hour rule", "kind": "audio"}, {"title": "Course quiz", "kind": "quiz"}]}
 ]'::jsonb, 10),
 (NULL, 'crop_season_plan', 'Season planning for one crop', 'crop_care', 'basic', '[
   {"title": "Before sowing", "lessons": [{"title": "Reading your soil card", "kind": "article"}, {"title": "Seed choice and treatment", "kind": "video"}]},
   {"title": "Through the season", "lessons": [{"title": "Water and nutrient calendar", "kind": "pdf"}, {"title": "Scouting for pests each week", "kind": "video"}, {"title": "Check yourself: the calendar", "kind": "quiz"}]},
   {"title": "Harvest and after", "lessons": [{"title": "Harvest timing and storage", "kind": "audio"}, {"title": "Course quiz", "kind": "quiz"}]}
 ]'::jsonb, 20),
 (NULL, 'scheme_walkthrough', 'A government scheme, step by step', 'schemes', 'basic', '[
   {"title": "Who it is for", "lessons": [{"title": "Eligibility in plain words", "kind": "article"}, {"title": "Documents to keep ready", "kind": "pdf"}]},
   {"title": "Applying", "lessons": [{"title": "Filling the form together", "kind": "video"}, {"title": "After you apply: tracking and appeals", "kind": "article"}, {"title": "Course quiz", "kind": "quiz"}]}
 ]'::jsonb, 30)
ON CONFLICT (code) WHERE tenant_id IS NULL DO NOTHING;
