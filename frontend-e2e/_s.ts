import { query, close } from './pkg/db.ts';
console.table(await query(`SELECT id,user_id,user_request_status_id st,flow_id FROM user_requests WHERE id>=464362 ORDER BY id`));
