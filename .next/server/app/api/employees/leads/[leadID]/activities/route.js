(()=>{var e={};e.id=841,e.ids=[841],e.modules={2849:e=>{function t(e){var t=Error("Cannot find module '"+e+"'");throw t.code="MODULE_NOT_FOUND",t}t.keys=()=>[],t.resolve=t,t.id=2849,e.exports=t},399:e=>{"use strict";e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},517:e=>{"use strict";e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},8893:e=>{"use strict";e.exports=require("buffer")},4770:e=>{"use strict";e.exports=require("crypto")},7702:e=>{"use strict";e.exports=require("events")},8216:e=>{"use strict";e.exports=require("net")},5816:e=>{"use strict";e.exports=require("process")},6162:e=>{"use strict";e.exports=require("stream")},4026:e=>{"use strict";e.exports=require("string_decoder")},5346:e=>{"use strict";e.exports=require("timers")},2452:e=>{"use strict";e.exports=require("tls")},7360:e=>{"use strict";e.exports=require("url")},1764:e=>{"use strict";e.exports=require("util")},1568:e=>{"use strict";e.exports=require("zlib")},7731:(e,t,r)=>{"use strict";r.r(t),r.d(t,{originalPathname:()=>x,patchFetch:()=>m,requestAsyncStorage:()=>l,routeModule:()=>d,serverHooks:()=>y,staticGenerationAsyncStorage:()=>v});var s={};r.r(s),r.d(s,{POST:()=>c,PUT:()=>p});var i=r(9303),a=r(8716),o=r(670),u=r(7070),n=r(9364);async function c(e,{params:t}){try{let{Mode:r,Notes:s,Status:i,ActivityDate:a}=await e.json();if(!r?.trim()||!s?.trim()||!i?.trim())return u.NextResponse.json({error:"Missing required fields"},{status:400});let o=Number(t.leadID);if(isNaN(o))return u.NextResponse.json({error:"Invalid LeadId"},{status:400});let c=await (0,n.M)(),[p]=await c.query(`
      SELECT StatusId
      FROM LeadStatuses
      WHERE StatusName = ?
      `,[i]),d=p[0]?.StatusId??1,[l]=await c.query(`
      INSERT INTO LeadActivities
        (LeadId, ActivityType, Notes, StatusId, ActivityDate)
      VALUES (?, ?, ?, ?, ?)
      `,[o,r,s,d,a?new Date(a):new Date]);return u.NextResponse.json({ActivityId:l.insertId,ActivityDate:a?new Date(a):new Date,Mode:r,Notes:s,Status:i})}catch(e){return console.error("Activity API error:",e),u.NextResponse.json({error:"Activity save failed"},{status:500})}}async function p(e,{params:t}){try{let{ActivityId:t,Mode:r,Notes:s,Status:i,ActivityDate:a}=await e.json();if(!t)return u.NextResponse.json({error:"ActivityId is required"},{status:400});let o=await (0,n.M)(),[c]=await o.query(`
      SELECT StatusId
      FROM LeadStatuses
      WHERE StatusName = ?
      `,[i]),p=c[0]?.StatusId??1;return await o.query(`
      UPDATE LeadActivities
      SET
        ActivityType = ?,
        Notes = ?,
        StatusId = ?,
        ActivityDate = ?
      WHERE ActivityId = ?
      `,[r,s,p,a?new Date(a):new Date,t]),u.NextResponse.json({success:!0})}catch(e){return console.error("Activity PUT error:",e),u.NextResponse.json({error:"Activity update failed"},{status:500})}}let d=new i.AppRouteRouteModule({definition:{kind:a.x.APP_ROUTE,page:"/api/employees/leads/[leadID]/activities/route",pathname:"/api/employees/leads/[leadID]/activities",filename:"route",bundlePath:"app/api/employees/leads/[leadID]/activities/route"},resolvedPagePath:"/home/ubuntu/Acarsh/Acarsh123/app/api/employees/leads/[leadID]/activities/route.ts",nextConfigOutput:"standalone",userland:s}),{requestAsyncStorage:l,staticGenerationAsyncStorage:v,serverHooks:y}=d,x="/api/employees/leads/[leadID]/activities/route";function m(){return(0,o.patchFetch)({serverHooks:y,staticGenerationAsyncStorage:v})}},9364:(e,t,r)=>{"use strict";r.d(t,{M:()=>o});var s=r(3785);let i={host:process.env.MYSQL_HOST,port:Number(process.env.MYSQL_PORT),user:process.env.MYSQL_USER,password:process.env.MYSQL_PASSWORD,database:process.env.MYSQL_DATABASE,waitForConnections:!0,connectionLimit:10,queueLimit:0},a=null;async function o(){return a||(a=s.createPool(i)),a}}};var t=require("../../../../../../webpack-runtime.js");t.C(e);var r=e=>t(t.s=e),s=t.X(0,[948,972,785],()=>r(7731));module.exports=s})();