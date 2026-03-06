(()=>{var e={};e.id=834,e.ids=[834],e.modules={2849:e=>{function r(e){var r=Error("Cannot find module '"+e+"'");throw r.code="MODULE_NOT_FOUND",r}r.keys=()=>[],r.resolve=r,r.id=2849,e.exports=r},399:e=>{"use strict";e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},517:e=>{"use strict";e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},8893:e=>{"use strict";e.exports=require("buffer")},4770:e=>{"use strict";e.exports=require("crypto")},7702:e=>{"use strict";e.exports=require("events")},8216:e=>{"use strict";e.exports=require("net")},5816:e=>{"use strict";e.exports=require("process")},6162:e=>{"use strict";e.exports=require("stream")},4026:e=>{"use strict";e.exports=require("string_decoder")},5346:e=>{"use strict";e.exports=require("timers")},2452:e=>{"use strict";e.exports=require("tls")},7360:e=>{"use strict";e.exports=require("url")},1764:e=>{"use strict";e.exports=require("util")},1568:e=>{"use strict";e.exports=require("zlib")},8232:(e,r,t)=>{"use strict";t.r(r),t.d(r,{originalPathname:()=>x,patchFetch:()=>N,requestAsyncStorage:()=>l,routeModule:()=>p,serverHooks:()=>R,staticGenerationAsyncStorage:()=>m});var s={};t.r(s),t.d(s,{POST:()=>d,PUT:()=>c});var i=t(9303),n=t(8716),o=t(670),a=t(7070),u=t(9364);async function d(e,{params:r}){try{let{ReminderDate:t,Notes:s,Status:i,Notification:n}=await e.json();if(!t||!s?.trim())return a.NextResponse.json({error:"Missing required fields"},{status:400});let o=Number(r.leadID);if(isNaN(o))return a.NextResponse.json({error:"Invalid LeadId"},{status:400});let d=await (0,u.M)(),[c]=await d.execute(`
      INSERT INTO LeadReminders
      (
        LeadId,
        ReminderDate,
        ReminderNote,
        Status,
        NotificationChannels,
        CreatedAt
      )
      VALUES (?, ?, ?, ?, ?, NOW())
      `,[o,new Date(t),s,i||"Pending",n||"Email"]),[p]=await d.execute(`
      SELECT
        ReminderId,
        DATE_FORMAT(ReminderDate, '%Y-%m-%d') AS ReminderDate,
        ReminderNote,
        Status,
        NotificationChannels
      FROM LeadReminders
      WHERE ReminderId = ?
      `,[c.insertId]);return a.NextResponse.json({ReminderId:p[0].ReminderId,ReminderDate:p[0].ReminderDate,Notes:p[0].ReminderNote,Status:p[0].Status,Notification:p[0].NotificationChannels})}catch(e){return console.error("Reminder POST error:",e),a.NextResponse.json({error:"Reminder save failed"},{status:500})}}async function c(e,{params:r}){try{let{ReminderId:r,ReminderDate:t,Notes:s,Status:i,Notification:n}=await e.json();if(!r)return a.NextResponse.json({error:"ReminderId is required"},{status:400});let o=await (0,u.M)();return await o.execute(`
      UPDATE LeadReminders
      SET
        ReminderDate = ?,
        ReminderNote = ?,
        Status = ?,
        NotificationChannels = ?
      WHERE ReminderId = ?
      `,[new Date(t),s,i,n,r]),a.NextResponse.json({success:!0})}catch(e){return console.error("Reminder PUT error:",e),a.NextResponse.json({error:"Reminder update failed"},{status:500})}}let p=new i.AppRouteRouteModule({definition:{kind:n.x.APP_ROUTE,page:"/api/employees/leads/[leadID]/reminders/route",pathname:"/api/employees/leads/[leadID]/reminders",filename:"route",bundlePath:"app/api/employees/leads/[leadID]/reminders/route"},resolvedPagePath:"/home/ubuntu/Acarsh/Acarsh123/app/api/employees/leads/[leadID]/reminders/route.ts",nextConfigOutput:"standalone",userland:s}),{requestAsyncStorage:l,staticGenerationAsyncStorage:m,serverHooks:R}=p,x="/api/employees/leads/[leadID]/reminders/route";function N(){return(0,o.patchFetch)({serverHooks:R,staticGenerationAsyncStorage:m})}},9364:(e,r,t)=>{"use strict";t.d(r,{M:()=>o});var s=t(3785);let i={host:process.env.MYSQL_HOST,port:Number(process.env.MYSQL_PORT),user:process.env.MYSQL_USER,password:process.env.MYSQL_PASSWORD,database:process.env.MYSQL_DATABASE,waitForConnections:!0,connectionLimit:10,queueLimit:0},n=null;async function o(){return n||(n=s.createPool(i)),n}}};var r=require("../../../../../../webpack-runtime.js");r.C(e);var t=e=>r(r.s=e),s=r.X(0,[948,972,785],()=>t(8232));module.exports=s})();