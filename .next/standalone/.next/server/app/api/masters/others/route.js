(()=>{var e={};e.id=508,e.ids=[508],e.modules={2849:e=>{function r(e){var r=Error("Cannot find module '"+e+"'");throw r.code="MODULE_NOT_FOUND",r}r.keys=()=>[],r.resolve=r,r.id=2849,e.exports=r},399:e=>{"use strict";e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},517:e=>{"use strict";e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},8893:e=>{"use strict";e.exports=require("buffer")},4770:e=>{"use strict";e.exports=require("crypto")},7702:e=>{"use strict";e.exports=require("events")},8216:e=>{"use strict";e.exports=require("net")},5816:e=>{"use strict";e.exports=require("process")},6162:e=>{"use strict";e.exports=require("stream")},4026:e=>{"use strict";e.exports=require("string_decoder")},5346:e=>{"use strict";e.exports=require("timers")},2452:e=>{"use strict";e.exports=require("tls")},7360:e=>{"use strict";e.exports=require("url")},1764:e=>{"use strict";e.exports=require("util")},1568:e=>{"use strict";e.exports=require("zlib")},9964:(e,r,t)=>{"use strict";t.r(r),t.d(r,{originalPathname:()=>S,patchFetch:()=>R,requestAsyncStorage:()=>d,routeModule:()=>c,serverHooks:()=>m,staticGenerationAsyncStorage:()=>E});var s={};t.r(s),t.d(s,{GET:()=>p});var o=t(9303),a=t(8716),i=t(670),u=t(7070),n=t(9364);async function p(){try{let e=await (0,n.M)(),[r]=await e.query(`
      SELECT
        Opportunity_StatusId,
        Opportunities_StatusName
      FROM Opportunities_Status
      ORDER BY Opportunity_StatusId
    `),[t]=await e.query(`
      SELECT DISTINCT CompanyName
      FROM Leads
      WHERE CompanyName IS NOT NULL
      ORDER BY CompanyName
    `),[s]=await e.query(`
      SELECT DISTINCT LeadSource
      FROM Leads
      WHERE LeadSource IS NOT NULL
      ORDER BY LeadSource
    `),[o]=await e.query(`
      SELECT DISTINCT UserId, UserName
      FROM Users
      WHERE UserName IS NOT NULL
      ORDER BY UserId
    `),[a]=await e.query(`
      SELECT DISTINCT Role
      FROM ContactRoles
      WHERE Role IS NOT NULL
      ORDER BY Role
    `),[i]=await e.query(`
      SELECT
        EngagementId,
        Engagement_ModelName
      FROM Engagement_Models
      ORDER BY EngagementId
    `),[p]=await e.query(`
      SELECT
        ServiceId,
        ServiceName
      FROM Services
      ORDER BY ServiceId
    `);return u.NextResponse.json({opportunityStatuses:r,companies:t,leadSources:s,ownername:o,Role:a,engagementModels:i,services:p})}catch(e){return console.error("Error fetching master data:",e),u.NextResponse.json({error:"Failed to fetch statuses"},{status:500})}}let c=new o.AppRouteRouteModule({definition:{kind:a.x.APP_ROUTE,page:"/api/masters/others/route",pathname:"/api/masters/others",filename:"route",bundlePath:"app/api/masters/others/route"},resolvedPagePath:"/home/ubuntu/Acarsh/Acarsh123/app/api/masters/others/route.ts",nextConfigOutput:"standalone",userland:s}),{requestAsyncStorage:d,staticGenerationAsyncStorage:E,serverHooks:m}=c,S="/api/masters/others/route";function R(){return(0,i.patchFetch)({serverHooks:m,staticGenerationAsyncStorage:E})}},9364:(e,r,t)=>{"use strict";t.d(r,{M:()=>i});var s=t(3785);let o={host:process.env.MYSQL_HOST,port:Number(process.env.MYSQL_PORT),user:process.env.MYSQL_USER,password:process.env.MYSQL_PASSWORD,database:process.env.MYSQL_DATABASE,waitForConnections:!0,connectionLimit:10,queueLimit:0},a=null;async function i(){return a||(a=s.createPool(o)),a}}};var r=require("../../../../webpack-runtime.js");r.C(e);var t=e=>r(r.s=e),s=r.X(0,[948,972,785],()=>t(9964));module.exports=s})();