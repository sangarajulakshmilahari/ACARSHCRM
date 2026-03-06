(()=>{var e={};e.id=924,e.ids=[924],e.modules={2849:e=>{function t(e){var t=Error("Cannot find module '"+e+"'");throw t.code="MODULE_NOT_FOUND",t}t.keys=()=>[],t.resolve=t,t.id=2849,e.exports=t},399:e=>{"use strict";e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},517:e=>{"use strict";e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},8893:e=>{"use strict";e.exports=require("buffer")},4770:e=>{"use strict";e.exports=require("crypto")},7702:e=>{"use strict";e.exports=require("events")},8216:e=>{"use strict";e.exports=require("net")},5816:e=>{"use strict";e.exports=require("process")},6162:e=>{"use strict";e.exports=require("stream")},4026:e=>{"use strict";e.exports=require("string_decoder")},5346:e=>{"use strict";e.exports=require("timers")},2452:e=>{"use strict";e.exports=require("tls")},7360:e=>{"use strict";e.exports=require("url")},1764:e=>{"use strict";e.exports=require("util")},1568:e=>{"use strict";e.exports=require("zlib")},1414:(e,t,a)=>{"use strict";a.r(t),a.d(t,{originalPathname:()=>N,patchFetch:()=>R,requestAsyncStorage:()=>L,routeModule:()=>p,serverHooks:()=>E,staticGenerationAsyncStorage:()=>m});var r={};a.r(r),a.d(r,{DELETE:()=>l,GET:()=>u,POST:()=>d});var s=a(9303),o=a(8716),n=a(670),i=a(7070),c=a(9364);async function u(){try{let e=await (0,c.M)(),[t]=await e.query(`
      SELECT
        l.LeadId,
        l.CompanyName,
        l.CompanyLocation,
        l.LeadSource,
        l.LeadDate,
        l.LeadNotes,
        ls.StatusName,
        lc.ContactName,
        lc.ContactTitle,
        lc.ContactEmail,
        lc.ContactPhone,
        cr.Role AS ContactRoleName,
        u.UserName AS OwnerName,
        at.AccountTypeId,
        at.Name AS AccountTypeName
      FROM Leads l
      LEFT JOIN LeadStatuses ls
        ON l.StatusId = ls.StatusId
      LEFT JOIN LeadContacts lc
        ON lc.LeadId = l.LeadId
      LEFT JOIN ContactRoles cr
        ON lc.ContactRoleId = cr.RoleId
      LEFT JOIN Users u
        ON l.OwnerId = u.UserId
      LEFT JOIN AccountTypes at
        ON l.AccountTypeId = at.AccountTypeId
      WHERE (at.Name IS NULL OR at.Name NOT IN ('Prospect','Account'))
    `),a={};return t.forEach(e=>{a[e.LeadId]||(a[e.LeadId]={LeadId:e.LeadId,CompanyName:e.CompanyName,CompanyLocation:e.CompanyLocation,LeadSource:e.LeadSource,LeadDate:e.LeadDate,LeadNotes:e.LeadNotes,StatusName:e.StatusName,OwnerName:e.OwnerName,Contacts:[]}),(e.ContactName||e.ContactEmail||e.ContactPhone)&&a[e.LeadId].Contacts.push({ContactName:e.ContactName,ContactTitle:e.ContactTitle,ContactEmail:e.ContactEmail,ContactPhone:e.ContactPhone,ContactRoleName:e.ContactRoleName})}),i.NextResponse.json(Object.values(a))}catch(e){return console.error("Error fetching leads:",e),i.NextResponse.json({error:"Failed to fetch leads"},{status:500})}}async function d(e){let t;try{let{CompanyName:a,CompanyLocation:r,LeadSource:s,LeadDate:o,StatusName:n,OwnerName:u,Notes:d,ContactName:l,ContactEmail:p,ContactPhone:L,ContactTitle:m,ContactRoleName:E,AddReminder:N}=await e.json(),R=await (0,c.M)();t=await R.getConnection(),await t.beginTransaction();let[C]=await t.query("SELECT StatusId FROM LeadStatuses WHERE StatusName = ?",[n]),I=C[0]?.StatusId??1,[y]=await t.query("SELECT UserId FROM Users WHERE UserName = ?",[u]),S=y[0]?.UserId??null,[O]=await t.query(`
      INSERT INTO Leads
        (CompanyName, CompanyLocation, LeadSource, LeadDate, LeadNotes, StatusId, OwnerId)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `,[a,r,s,o,d,I,S]),T=O.insertId;if(l||p||L){if(!E)return await t.rollback(),i.NextResponse.json({error:"Contact role is required"},{status:400});let[e]=await t.query("SELECT RoleId FROM ContactRoles WHERE Role = ?",[E]);if(!e.length)return await t.rollback(),i.NextResponse.json({error:"Invalid Contact Role"},{status:400});let a=e[0].RoleId;await t.query(`
        INSERT INTO LeadContacts
          (LeadId, ContactName, ContactEmail, ContactPhone, ContactTitle, ContactRoleId)
        VALUES (?, ?, ?, ?, ?, ?)
        `,[T,l,p,L,m,a])}return N&&await t.query(`
        INSERT INTO Reminders (LeadId, ReminderDate)
        VALUES (?, NOW())
        `,[T]),await t.commit(),i.NextResponse.json({message:"Lead created successfully",LeadId:T},{status:200})}catch(e){return t&&await t.rollback(),console.error("Error creating lead:",e),i.NextResponse.json({error:"Failed to create lead",details:e.message},{status:500})}finally{t&&t.release()}}async function l(e){let t;try{let{searchParams:a}=new URL(e.url),r=Number(a.get("leadId"));if(isNaN(r))return i.NextResponse.json({error:"LeadId is required"},{status:400});let s=await (0,c.M)();return t=await s.getConnection(),await t.beginTransaction(),await t.query("DELETE FROM LeadContacts WHERE LeadId = ?",[r]),await t.query("DELETE FROM LeadActivities WHERE LeadId = ?",[r]),await t.query("DELETE FROM LeadReminders WHERE LeadId = ?",[r]),await t.query("DELETE FROM Opportunities WHERE LeadId = ?",[r]),await t.query("DELETE FROM Leads WHERE LeadId = ?",[r]),await t.commit(),i.NextResponse.json({message:"Lead deleted successfully"})}catch(e){return t&&await t.rollback(),console.error("Delete lead error:",e),i.NextResponse.json({error:"Failed to delete lead"},{status:500})}finally{t&&t.release()}}let p=new s.AppRouteRouteModule({definition:{kind:o.x.APP_ROUTE,page:"/api/employees/leads/route",pathname:"/api/employees/leads",filename:"route",bundlePath:"app/api/employees/leads/route"},resolvedPagePath:"/home/ubuntu/Acarsh/Acarsh123/app/api/employees/leads/route.ts",nextConfigOutput:"standalone",userland:r}),{requestAsyncStorage:L,staticGenerationAsyncStorage:m,serverHooks:E}=p,N="/api/employees/leads/route";function R(){return(0,n.patchFetch)({serverHooks:E,staticGenerationAsyncStorage:m})}},9364:(e,t,a)=>{"use strict";a.d(t,{M:()=>n});var r=a(3785);let s={host:process.env.MYSQL_HOST,port:Number(process.env.MYSQL_PORT),user:process.env.MYSQL_USER,password:process.env.MYSQL_PASSWORD,database:process.env.MYSQL_DATABASE,waitForConnections:!0,connectionLimit:10,queueLimit:0},o=null;async function n(){return o||(o=r.createPool(s)),o}}};var t=require("../../../../webpack-runtime.js");t.C(e);var a=e=>t(t.s=e),r=t.X(0,[948,972,785],()=>a(1414));module.exports=r})();