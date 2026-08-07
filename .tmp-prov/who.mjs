import postgres from "postgres"; import {readFileSync} from "node:fs";
const url=(readFileSync(".env.local","utf8").match(/^DATABASE_URL=(.+)$/m)||[])[1].trim();
const sql=postgres(url,{max:1});
try{
 console.log(JSON.stringify(await sql`SELECT id,email,plan,is_active FROM users WHERE plan<>'free'`,null,1));
 console.log("board_accounts:", JSON.stringify(await sql`SELECT id,user_id,board,status FROM board_accounts`));
 console.log("candidate_profiles:", JSON.stringify(await sql`SELECT user_id, preferences FROM candidate_profiles`).slice(0,400));
} finally{await sql.end({timeout:5});}
