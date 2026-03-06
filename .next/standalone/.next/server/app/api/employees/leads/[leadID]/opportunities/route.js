(()=>{var e={};e.id=611,e.ids=[611],e.modules={2849:e=>{function t(e){var t=Error("Cannot find module '"+e+"'");throw t.code="MODULE_NOT_FOUND",t}t.keys=()=>[],t.resolve=t,t.id=2849,e.exports=t},399:e=>{"use strict";e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},517:e=>{"use strict";e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},8893:e=>{"use strict";e.exports=require("buffer")},4770:e=>{"use strict";e.exports=require("crypto")},7702:e=>{"use strict";e.exports=require("events")},8216:e=>{"use strict";e.exports=require("net")},5816:e=>{"use strict";e.exports=require("process")},6162:e=>{"use strict";e.exports=require("stream")},4026:e=>{"use strict";e.exports=require("string_decoder")},5346:e=>{"use strict";e.exports=require("timers")},2452:e=>{"use strict";e.exports=require("tls")},7360:e=>{"use strict";e.exports=require("url")},1764:e=>{"use strict";e.exports=require("util")},1568:e=>{"use strict";e.exports=require("zlib")},9742:(e,t,r)=>{"use strict";r.r(t),r.d(t,{originalPathname:()=>g,patchFetch:()=>N,requestAsyncStorage:()=>O,routeModule:()=>I,serverHooks:()=>S,staticGenerationAsyncStorage:()=>c});var o={};r.r(o),r.d(o,{GET:()=>l,POST:()=>p,PUT:()=>d});var a=r(9303),i=r(8716),s=r(670),n=r(7070),u=r(9364);async function p(e,{params:t}){let r;let o=Number(t.leadID);if(isNaN(o))return n.NextResponse.json({error:"Invalid Lead ID"},{status:400});let{serviceId:a,statusId:i,probabilityId:s,engagementId:p,technologies:d,otherTechnologies:l,hasOtherTechnology:I}=await e.json();if(!a||!i||!s||!p||!Array.isArray(d))return n.NextResponse.json({error:"Invalid request payload"},{status:400});let O=await (0,u.M)();try{r=await O.getConnection(),await r.beginTransaction();let[e]=await r.query(`
      INSERT INTO Opportunities
      (
        LeadId,
        ServiceId,
        ProbabilityId,
        EngagementId,
        Opportunity_StatusId,
        CreatedOn,
        IsDeleted
      )
      VALUES (?, ?, ?, ?, ?, NOW(), 0)
      `,[o,a,s,p,i]),t=e.insertId,u=[...d];if(I&&l&&Object.keys(l).length>0)for(let[e,t]of Object.entries(l)){let o;let[a]=await r.query("SELECT SubCategoryId FROM SubCategory WHERE SubCategoryName = ?",[t]);if(a.length>0)o=a[0].SubCategoryId;else{let[a]=await r.query(`
            INSERT INTO SubCategory (SubCategoryName, CategoryId)
            SELECT ?, CategoryId
            FROM SubCategory
            WHERE SubCategoryId = ?
            `,[t,Number(e)]);o=a.insertId}(u=u.filter(t=>t!==Number(e))).push(o)}for(let e of u)await r.query(`
        INSERT INTO Opportunity_Categories
        (OpportunityId, SubCategoryId)
        VALUES (?, ?)
        `,[t,e]);await r.commit();let[c]=await O.query(y(),[t]);return n.NextResponse.json(c[0])}catch(e){return r&&await r.rollback(),console.error("POST opportunity error:",e),n.NextResponse.json({error:"Failed to create opportunity"},{status:500})}finally{r&&r.release()}}async function d(e,{params:t}){let r;let{OpportunityId:o,serviceId:a,statusId:i,probabilityId:s,engagementId:p,technologies:d,otherTechnologies:l,hasOtherTechnology:I}=await e.json();if(!o||!a||!i||!s||!p||!Array.isArray(d))return n.NextResponse.json({error:"Invalid request payload"},{status:400});let O=await (0,u.M)();try{r=await O.getConnection(),await r.beginTransaction(),await r.query(`
      UPDATE Opportunities
      SET
        ServiceId = ?,
        ProbabilityId = ?,
        EngagementId = ?,
        Opportunity_StatusId = ?,
        ModifiedOn = NOW()
      WHERE OpportunityId = ?
      `,[a,s,p,i,o]),await r.query(`
      DELETE FROM Opportunity_Categories
      WHERE OpportunityId = ?
      `,[o]);let e=[...d];if(I&&l&&Object.keys(l).length>0)for(let[t,o]of Object.entries(l)){let a;let[i]=await r.query("SELECT SubCategoryId FROM SubCategory WHERE SubCategoryName = ?",[o]);if(i.length>0)a=i[0].SubCategoryId;else{let[e]=await r.query(`
            INSERT INTO SubCategory (SubCategoryName, CategoryId)
            SELECT ?, CategoryId
            FROM SubCategory
            WHERE SubCategoryId = ?
            `,[o,Number(t)]);a=e.insertId}(e=e.filter(e=>e!==Number(t))).push(a)}for(let t of e)await r.query(`
        INSERT INTO Opportunity_Categories
        (OpportunityId, SubCategoryId)
        VALUES (?, ?)
        `,[o,t]);await r.commit();let[t]=await O.query(y(),[o]);return n.NextResponse.json(t[0])}catch(e){return r&&await r.rollback(),console.error("PUT opportunity error:",e),n.NextResponse.json({error:"Failed to update opportunity"},{status:500})}finally{r&&r.release()}}async function l(e,{params:t}){let{searchParams:r}=new URL(e.url),o=Number(r.get("OpportunityId"));if(isNaN(o))return n.NextResponse.json({error:"OpportunityId required"},{status:400});try{let e=await (0,u.M)(),[t]=await e.query(`
      SELECT
        o.OpportunityId,
        o.ServiceId,
        o.ProbabilityId,
        o.Opportunity_StatusId AS StatusId,
        o.EngagementId,

        s.ServiceName AS Service,
        p.ProbabilityRange AS Probability,
        os.Opportunities_StatusName AS Status,
        em.Engagement_ModelName AS EngagementModel,

        GROUP_CONCAT(sc.SubCategoryName SEPARATOR ', ') AS Technology,
        GROUP_CONCAT(sc.SubCategoryId SEPARATOR ',') AS TechnologyIds
      FROM Opportunities o
      LEFT JOIN Services s ON o.ServiceId = s.ServiceId
      LEFT JOIN Probability p ON o.ProbabilityId = p.ProbabilityId
      LEFT JOIN Opportunities_Status os ON o.Opportunity_StatusId = os.Opportunity_StatusId
      LEFT JOIN Engagement_Models em ON o.EngagementId = em.EngagementId
      LEFT JOIN Opportunity_Categories oc ON o.OpportunityId = oc.OpportunityId
      LEFT JOIN SubCategory sc ON oc.SubCategoryId = sc.SubCategoryId
      WHERE o.OpportunityId = ?
      GROUP BY
        o.OpportunityId,
        o.ServiceId,
        o.ProbabilityId,
        o.Opportunity_StatusId,
        o.EngagementId,
        s.ServiceName,
        p.ProbabilityRange,
        os.Opportunities_StatusName,
        em.Engagement_ModelName
      `,[o]),r=t[0];return n.NextResponse.json({...r,TechnologyIds:r.TechnologyIds?r.TechnologyIds.split(",").map(Number):[]})}catch(e){return console.error("GET opportunity error:",e),n.NextResponse.json({error:"Failed to fetch opportunity"},{status:500})}}function y(){return`
    SELECT
      o.OpportunityId,

      -- IDS
      o.ServiceId,
      o.ProbabilityId,
      o.Opportunity_StatusId AS StatusId,
      o.EngagementId,

      -- DISPLAY
      s.ServiceName AS Service,
      p.ProbabilityRange AS Probability,
      os.Opportunities_StatusName AS Status,
      em.Engagement_ModelName AS EngagementModel,

      -- TECHNOLOGY
      GROUP_CONCAT(DISTINCT sc.SubCategoryName SEPARATOR ', ') AS Technology,
      GROUP_CONCAT(DISTINCT sc.SubCategoryId SEPARATOR ',') AS TechnologyIds,

      -- OPPORTUNITY CONTACTS (GROUPED)
      GROUP_CONCAT(
        DISTINCT CONCAT(
          'Full Name: ', oc.FullName, '
',
          'Mobile: ', oc.MobilePhone, '
',
          'Email: ', oc.WorkEmail
        )
        SEPARATOR '
---
'
      ) AS OpportunityContact,

      o.CreatedOn AS CreatedDate
    FROM Opportunities o
    LEFT JOIN Services s ON o.ServiceId = s.ServiceId
    LEFT JOIN Probability p ON o.ProbabilityId = p.ProbabilityId
    LEFT JOIN Opportunities_Status os ON o.Opportunity_StatusId = os.Opportunity_StatusId
    LEFT JOIN Engagement_Models em ON o.EngagementId = em.EngagementId
    LEFT JOIN Opportunity_Categories ocg ON o.OpportunityId = ocg.OpportunityId
    LEFT JOIN SubCategory sc ON ocg.SubCategoryId = sc.SubCategoryId
    LEFT JOIN OpportunityContacts oc
      ON o.OpportunityId = oc.OpportunityId
     AND oc.IsDeleted = 0
    WHERE o.OpportunityId = ?
    GROUP BY
      o.OpportunityId,
      o.ServiceId,
      o.ProbabilityId,
      o.Opportunity_StatusId,
      o.EngagementId,
      s.ServiceName,
      p.ProbabilityRange,
      os.Opportunities_StatusName,
      em.Engagement_ModelName,
      o.CreatedOn
  `}let I=new a.AppRouteRouteModule({definition:{kind:i.x.APP_ROUTE,page:"/api/employees/leads/[leadID]/opportunities/route",pathname:"/api/employees/leads/[leadID]/opportunities",filename:"route",bundlePath:"app/api/employees/leads/[leadID]/opportunities/route"},resolvedPagePath:"/home/ubuntu/Acarsh/Acarsh123/app/api/employees/leads/[leadID]/opportunities/route.ts",nextConfigOutput:"standalone",userland:o}),{requestAsyncStorage:O,staticGenerationAsyncStorage:c,serverHooks:S}=I,g="/api/employees/leads/[leadID]/opportunities/route";function N(){return(0,s.patchFetch)({serverHooks:S,staticGenerationAsyncStorage:c})}},9364:(e,t,r)=>{"use strict";r.d(t,{M:()=>s});var o=r(3785);let a={host:process.env.MYSQL_HOST,port:Number(process.env.MYSQL_PORT),user:process.env.MYSQL_USER,password:process.env.MYSQL_PASSWORD,database:process.env.MYSQL_DATABASE,waitForConnections:!0,connectionLimit:10,queueLimit:0},i=null;async function s(){return i||(i=o.createPool(a)),i}}};var t=require("../../../../../../webpack-runtime.js");t.C(e);var r=e=>t(t.s=e),o=t.X(0,[948,972,785],()=>r(9742));module.exports=o})();