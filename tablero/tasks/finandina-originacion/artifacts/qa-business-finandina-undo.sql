-- Deshace BUSINESS_FINANDINA en qa (creado 2026-11-19T14:02:20.598Z). Correr con I_KNOW_THIS_TOUCHES_SHARED_DEV.
DELETE FROM lender_rules WHERE group_rule_id IN (9960);
DELETE FROM group_rules WHERE id IN (9960);
DELETE FROM lenders_by_allied_branches WHERE allied_branch_id = 2247;
DELETE FROM lenders_by_allieds WHERE allied_id = 368;
DELETE FROM allied_branches WHERE id = 2247;
DELETE FROM allied_flags WHERE allied_id = 368;
DELETE FROM allieds WHERE id = 368 AND name = 'BUSINESS_FINANDINA';
