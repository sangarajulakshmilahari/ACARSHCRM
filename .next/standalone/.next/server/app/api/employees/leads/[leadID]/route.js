(()=>{var e={};e.id=419,e.ids=[419],e.modules={2849:e=>{function t(e){var t=Error("Cannot find module '"+e+"'");throw t.code="MODULE_NOT_FOUND",t}t.keys=()=>[],t.resolve=t,t.id=2849,e.exports=t},399:e=>{"use strict";e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},517:e=>{"use strict";e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},8893:e=>{"use strict";e.exports=require("buffer")},4770:e=>{"use strict";e.exports=require("crypto")},7702:e=>{"use strict";e.exports=require("events")},8216:e=>{"use strict";e.exports=require("net")},5816:e=>{"use strict";e.exports=require("process")},6162:e=>{"use strict";e.exports=require("stream")},4026:e=>{"use strict";e.exports=require("string_decoder")},5346:e=>{"use strict";e.exports=require("timers")},2452:e=>{"use strict";e.exports=require("tls")},7360:e=>{"use strict";e.exports=require("url")},1764:e=>{"use strict";e.exports=require("util")},1568:e=>{"use strict";e.exports=require("zlib")},3724:(e,t,a)=>{"use strict";a.r(t),a.d(t,{originalPathname:()=>I,patchFetch:()=>m,requestAsyncStorage:()=>p,routeModule:()=>E,serverHooks:()=>O,staticGenerationAsyncStorage:()=>R});var r={};a.r(r),a.d(r,{DELETE:()=>c,GET:()=>d,PUT:()=>u});var s=a(9303),o=a(8716),n=a(670),i=a(7070),l=a(9364);async function d(e,{params:t}){try{let e=Number(t.leadID);if(isNaN(e))return i.NextResponse.json({error:"Invalid LeadId"},{status:400});let a=await (0,l.M)(),r=await a.getConnection();try{let[t]=await r.query(`
        SELECT
          l.LeadId,
          l.CompanyName,
          l.CompanyLocation,
          l.LeadSource,
          DATE_FORMAT(l.LeadDate, '%Y-%m-%d') AS LeadDate,
          l.LeadNotes,
          ls.StatusName,
          u.UserName AS OwnerName
        FROM Leads l
        LEFT JOIN LeadStatuses ls ON l.StatusId = ls.StatusId
        LEFT JOIN Users u ON l.OwnerId = u.UserId
        WHERE l.LeadId = ?
        `,[e]);if(!t.length)return i.NextResponse.json({error:"Lead not found"},{status:404});let[a]=await r.query(`
        SELECT
          lc.ContactName,
          lc.ContactTitle,
          lc.ContactEmail,
          cr.Role AS ContactRoleName
        FROM LeadContacts lc
        LEFT JOIN ContactRoles cr ON lc.ContactRoleId = cr.RoleId
        WHERE lc.LeadId = ?
        `,[e]),[s]=await r.query(`
        SELECT
          la.ActivityId,
          DATE_FORMAT(la.ActivityDate, '%Y-%m-%d') AS ActivityDate,
          la.ActivityType AS Mode,
          la.Notes,
          ls.StatusName AS Status
        FROM LeadActivities la
        LEFT JOIN LeadStatuses ls ON la.StatusId = ls.StatusId
        WHERE la.LeadId = ?
        ORDER BY la.ActivityDate DESC
        `,[e]),[o]=await r.query(`
        SELECT
          lr.ReminderId,
          DATE_FORMAT(lr.ReminderDate, '%Y-%m-%d') AS ReminderDate,
          lr.ReminderNote AS Notes,
          lr.Status,
          lr.NotificationChannels AS Notification
        FROM LeadReminders lr
        WHERE lr.LeadId = ?
        ORDER BY lr.ReminderDate DESC
        `,[e]),[n]=await r.query(`
        SELECT
          o.OpportunityId,
          DATE_FORMAT(o.CreatedOn, '%Y-%m-%d') AS CreatedDate,
          s.ServiceName AS Service,
          pm.ProbabilityRange AS Probability,
          os.Opportunities_StatusName AS Status,
          em.Engagement_ModelName AS EngagementModel,
          tech.Technology,
          cnt.OpportunityContact
        FROM Opportunities o
        LEFT JOIN Services s ON o.ServiceId = s.ServiceId
        LEFT JOIN Opportunities_Status os ON o.Opportunity_StatusId = os.Opportunity_StatusId
        LEFT JOIN Probability pm ON o.ProbabilityId = pm.ProbabilityId
        LEFT JOIN Engagement_Models em ON o.EngagementId = em.EngagementId
        LEFT JOIN (
          SELECT
            oc.OpportunityId,
            GROUP_CONCAT(sc.SubCategoryName SEPARATOR ', ') AS Technology
          FROM Opportunity_Categories oc
          JOIN SubCategory sc ON oc.SubCategoryId = sc.SubCategoryId
          GROUP BY oc.OpportunityId
        ) tech ON tech.OpportunityId = o.OpportunityId
        LEFT JOIN (
          SELECT
            OpportunityId,
            GROUP_CONCAT(
              CONCAT(
                'Full Name: ', FullName, '
',
                'Mobile: ', MobilePhone, '
',
                'Email: ', WorkEmail
              )
              SEPARATOR '
'
            ) AS OpportunityContact
          FROM OpportunityContacts
          WHERE IsDeleted = 0
          GROUP BY OpportunityId
        ) cnt ON cnt.OpportunityId = o.OpportunityId
        WHERE o.LeadId = ?
          AND o.IsDeleted = 0
        ORDER BY o.CreatedOn DESC
        `,[e]);return i.NextResponse.json({...t[0],Contacts:a,Activities:s,Reminders:o,Opportunities:n})}finally{r.release()}}catch(e){return console.error("Get lead error:",e),i.NextResponse.json({error:"Failed to fetch lead details"},{status:500})}}async function u(e,{params:t}){let a=Number(t.leadID);if(isNaN(a))return i.NextResponse.json({error:"Invalid LeadId"},{status:400});let{CompanyName:r,CompanyLocation:s,LeadSource:o,LeadDate:n,OwnerName:d,StatusName:u,LeadNotes:c,Contacts:E}=await e.json(),p=await (0,l.M)(),R=await p.getConnection();try{await R.beginTransaction();let e=null;if(u){let[t]=await R.query("SELECT StatusId FROM LeadStatuses WHERE StatusName = ?",[u]);t.length&&(e=t[0].StatusId)}let t=null;if(d){let[e]=await R.query("SELECT UserId FROM Users WHERE UserName = ?",[d]);e.length&&(t=e[0].UserId)}if(await R.query(`
      UPDATE Leads SET
        CompanyName = ?,
        CompanyLocation = ?,
        LeadSource = ?,
        LeadDate = ?,
        LeadNotes = ?,
        StatusId = ?,
        OwnerId = ?
      WHERE LeadId = ?
      `,[r||null,s||null,o||null,n||null,c||null,e,t,a]),Array.isArray(E))for(let e of(await R.query("DELETE FROM LeadContacts WHERE LeadId = ?",[a]),E)){let t=null;if(e.ContactRoleName){let[a]=await R.query("SELECT RoleId FROM ContactRoles WHERE Role = ?",[e.ContactRoleName]);a.length&&(t=a[0].RoleId)}if(!t){let[e]=await R.query("SELECT RoleId FROM ContactRoles WHERE Role = 'Decision Maker' LIMIT 1");e.length&&(t=e[0].RoleId)}await R.query(`
          INSERT INTO LeadContacts
          (LeadId, ContactName, ContactEmail, ContactTitle, ContactPhone, ContactRoleId)
          VALUES (?, ?, ?, ?, ?, ?)
          `,[a,e.ContactName||null,e.ContactEmail||null,e.ContactTitle||null,e.ContactPhone||null,t])}return await R.commit(),i.NextResponse.json({success:!0,LeadId:a,message:"Lead updated successfully"})}catch(e){return await R.rollback(),console.error("Update lead error:",e),i.NextResponse.json({error:e.message||"Failed to update lead"},{status:500})}finally{R.release()}}async function c(e,{params:t}){let a=Number(t.leadID);if(isNaN(a))return i.NextResponse.json({error:"Invalid LeadId"},{status:400});let r=await (0,l.M)(),s=await r.getConnection();try{return await s.beginTransaction(),await s.query("DELETE FROM LeadContacts WHERE LeadId = ?",[a]),await s.query("DELETE FROM LeadActivities WHERE LeadId = ?",[a]),await s.query("DELETE FROM LeadReminders WHERE LeadId = ?",[a]),await s.query("DELETE FROM Opportunities WHERE LeadId = ?",[a]),await s.query("DELETE FROM Leads WHERE LeadId = ?",[a]),await s.commit(),i.NextResponse.json({success:!0,message:"Lead deleted successfully"})}catch(e){return await s.rollback(),console.error("Delete lead error:",e),i.NextResponse.json({error:e.message||"Failed to delete lead"},{status:500})}finally{s.release()}}let E=new s.AppRouteRouteModule({definition:{kind:o.x.APP_ROUTE,page:"/api/employees/leads/[leadID]/route",pathname:"/api/employees/leads/[leadID]",filename:"route",bundlePath:"app/api/employees/leads/[leadID]/route"},resolvedPagePath:"/home/ubuntu/Acarsh/Acarsh123/app/api/employees/leads/[leadID]/route.ts",nextConfigOutput:"standalone",userland:r}),{requestAsyncStorage:p,staticGenerationAsyncStorage:R,serverHooks:O}=E,I="/api/employees/leads/[leadID]/route";function m(){return(0,n.patchFetch)({serverHooks:O,staticGenerationAsyncStorage:R})}},9364:(e,t,a)=>{"use strict";a.d(t,{M:()=>n});var r=a(3785);let s={host:process.env.MYSQL_HOST,port:Number(process.env.MYSQL_PORT),user:process.env.MYSQL_USER,password:process.env.MYSQL_PASSWORD,database:process.env.MYSQL_DATABASE,waitForConnections:!0,connectionLimit:10,queueLimit:0},o=null;async function n(){return o||(o=r.createPool(s)),o}}};var t=require("../../../../../webpack-runtime.js");t.C(e);var a=e=>t(t.s=e),r=t.X(0,[948,972,785],()=>a(3724));module.exports=r})();