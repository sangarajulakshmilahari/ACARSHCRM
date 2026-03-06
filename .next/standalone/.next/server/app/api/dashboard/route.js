(()=>{var e={};e.id=707,e.ids=[707],e.modules={2849:e=>{function t(e){var t=Error("Cannot find module '"+e+"'");throw t.code="MODULE_NOT_FOUND",t}t.keys=()=>[],t.resolve=t,t.id=2849,e.exports=t},399:e=>{"use strict";e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},517:e=>{"use strict";e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},8893:e=>{"use strict";e.exports=require("buffer")},4770:e=>{"use strict";e.exports=require("crypto")},7702:e=>{"use strict";e.exports=require("events")},8216:e=>{"use strict";e.exports=require("net")},5816:e=>{"use strict";e.exports=require("process")},6162:e=>{"use strict";e.exports=require("stream")},4026:e=>{"use strict";e.exports=require("string_decoder")},5346:e=>{"use strict";e.exports=require("timers")},2452:e=>{"use strict";e.exports=require("tls")},7360:e=>{"use strict";e.exports=require("url")},1764:e=>{"use strict";e.exports=require("util")},1568:e=>{"use strict";e.exports=require("zlib")},6601:(e,t,r)=>{"use strict";r.r(t),r.d(t,{originalPathname:()=>S,patchFetch:()=>p,requestAsyncStorage:()=>c,routeModule:()=>l,serverHooks:()=>L,staticGenerationAsyncStorage:()=>O});var a={};r.r(a),r.d(a,{GET:()=>n});var s=r(9303),u=r(8716),d=r(670),o=r(7070),i=r(9364);async function n(){try{let e=await (0,i.M)(),[t]=await e.query(`
      SELECT COUNT(LeadId) AS totalLeads
      FROM Leads
    `),r=`
      WITH LatestActivity AS (
        SELECT
          la.LeadId,
          la.StatusId,
          ROW_NUMBER() OVER (
            PARTITION BY la.LeadId
            ORDER BY la.ActivityDate DESC, la.CreatedOn DESC
          ) AS rn
        FROM LeadActivities la
      )
    `,[a]=await e.query(`
      ${r}
      SELECT
        COALESCE(la.StatusId, l.StatusId) AS StatusId,
        COUNT(l.LeadId) AS count
      FROM Leads l
      LEFT JOIN LatestActivity la
        ON la.LeadId = l.LeadId
        AND la.rn = 1
      GROUP BY COALESCE(la.StatusId, l.StatusId)
      ORDER BY StatusId
    `),[s]=await e.query(`
      ${r}
      SELECT
        ls.StatusName,
        COUNT(l.LeadId) AS count
      FROM LeadStatuses ls
      LEFT JOIN Leads l
        ON ls.StatusId = (
          SELECT COALESCE(la.StatusId, l2.StatusId)
          FROM Leads l2
          LEFT JOIN LatestActivity la
            ON la.LeadId = l2.LeadId
            AND la.rn = 1
          WHERE l2.LeadId = l.LeadId
        )
      GROUP BY ls.StatusName, ls.SortOrder
      ORDER BY ls.SortOrder
    `),[u]=await e.query(`
      SELECT
        u.UserName AS OwnerName,
        COUNT(l.LeadId) AS count
      FROM Leads l
      INNER JOIN Users u
        ON l.OwnerId = u.UserId
      GROUP BY u.UserName
      ORDER BY count DESC
    `),[d]=await e.query(`
      SELECT
        DATE_FORMAT(l.LeadDate, '%b %Y') AS MonthYear,
        YEAR(l.LeadDate) AS YearNum,
        MONTH(l.LeadDate) AS MonthNum,
        u.UserName AS OwnerName,
        COUNT(l.LeadId) AS count
      FROM Leads l
      INNER JOIN Users u
        ON l.OwnerId = u.UserId
      GROUP BY
        DATE_FORMAT(l.LeadDate, '%b %Y'),
        YEAR(l.LeadDate),
        MONTH(l.LeadDate),
        u.UserName
      ORDER BY
        YearNum,
        MonthNum
    `);return o.NextResponse.json({totalLeads:t[0]?.totalLeads??0,statusCounts:a,leadsByStatus:s,leadsByOwner:u,monthlyTrends:d})}catch(e){return console.error("DASHBOARD ROUTE ERROR:",e),o.NextResponse.json({error:"Failed to fetch dashboard data"},{status:500})}}let l=new s.AppRouteRouteModule({definition:{kind:u.x.APP_ROUTE,page:"/api/dashboard/route",pathname:"/api/dashboard",filename:"route",bundlePath:"app/api/dashboard/route"},resolvedPagePath:"/home/ubuntu/Acarsh/Acarsh123/app/api/dashboard/route.ts",nextConfigOutput:"standalone",userland:a}),{requestAsyncStorage:c,staticGenerationAsyncStorage:O,serverHooks:L}=l,S="/api/dashboard/route";function p(){return(0,d.patchFetch)({serverHooks:L,staticGenerationAsyncStorage:O})}},9364:(e,t,r)=>{"use strict";r.d(t,{M:()=>d});var a=r(3785);let s={host:process.env.MYSQL_HOST,port:Number(process.env.MYSQL_PORT),user:process.env.MYSQL_USER,password:process.env.MYSQL_PASSWORD,database:process.env.MYSQL_DATABASE,waitForConnections:!0,connectionLimit:10,queueLimit:0},u=null;async function d(){return u||(u=a.createPool(s)),u}}};var t=require("../../../webpack-runtime.js");t.C(e);var r=e=>t(t.s=e),a=t.X(0,[948,972,785],()=>r(6601));module.exports=a})();