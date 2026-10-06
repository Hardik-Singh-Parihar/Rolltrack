/*
 * RollTrack web demo: seeds SAMPLE data (fictional people) into this browser's localStorage
 * the first time the demo opens, and shows a small notice. It is only used by docs/ (the web
 * demo). The Chrome extension does not load this file.
 *   ?empty  -> open the demo with no sample data
 *   ?reset  -> wipe the demo data and reseed
 */
(function () {
  var K = { meetings: 'rolltrack_meetings', rosters: 'rolltrack_master_roster_sheets', ids: 'rolltrack_active_roster_ids' };
  var q = location.search;
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function day(offset) { var d = new Date(); d.setDate(d.getDate() - offset); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function seed() {
    var A = ['Aarav Mehta', 'Diya Nair', 'Kabir Sethi', 'Ishita Rao', 'Rohan Das'];
    var B = ['Meera Kulkarni', 'Neel Joshi', 'Tara Iyer', 'Vikram Shah', 'Zoya Khan'];
    var C = ['Anaya Bose', 'Dev Malhotra', 'Farah Ali', 'Hiten Patel'];
    var students = []; var n = 0;
    [['Division A', A], ['Division B', B], ['Division C', C]].forEach(function (g) {
      g[1].forEach(function (name, i) { students.push({ id: 'demo-s' + (n++), name: name, rollNo: i + 1, division: g[0] }); });
    });
    var roster = { id: 'demo-roster', name: 'Sample Class Roster', fileName: 'sample-class-roster.xlsx', uploadedAt: day(0), totalRecords: students.length, divisions: ['Division A', 'Division B', 'Division C'], students: students };
    var k = 0;
    function att(name, pct, total) { k++; return { id: 'demo-a' + k, rollNo: 0, name: name, email: '', durationMinutes: Math.round(total * pct / 100), totalMinutes: total, presencePercentage: pct }; }
    function meeting(id, title, date, start, end, total, people) {
      return { id: id, title: title, platform: 'Google Meet', date: date, startTime: start, endTime: end, durationMinutes: total, attendeeCount: people.length,
        hostName: 'Sample Teacher', hostEmail: '', attendanceGoal: 75, isGoalConfirmed: false, activityLog: [],
        metrics: { screenShares: 0, micsUnmuted: 0, camerasTurnedOn: 0, handsRaised: 0 },
        attendees: people.map(function (p) { return att(p[0], p[1], total); }) };
    }
    var meetings = [
      meeting('demo-m1', 'Physics: Wave Optics', day(0), '10:00', '11:00', 60,
        [['Aarav Mehta', 98], ['Diya Nair', 92], ['Kabir Sethi', 60], ['Meera Kulkarni', 95], ['Neel Joshi', 81], ['Tara Iyer', 40], ['Anaya Bose', 90], ['Dev Malhotra', 77]]),
      meeting('demo-m2', 'Maths: Calculus Revision', day(1), '14:00', '15:00', 60,
        [['Ishita Rao', 97], ['Rohan Das', 70], ['Farah Ali', 88], ['Hiten Patel', 55]]),
      meeting('demo-m3', 'Chemistry: Lab Briefing', day(3), '09:30', '10:15', 45,
        [['Vikram Shah', 94], ['Zoya Khan', 85], ['Aarav Mehta', 78], ['Visiting Guest', 90]])
    ];
    localStorage.setItem(K.rosters, JSON.stringify([roster]));
    localStorage.setItem(K.ids, JSON.stringify(['demo-roster']));
    localStorage.setItem(K.meetings, JSON.stringify(meetings));
  }
  try {
    if (/[?&]reset\b/.test(q)) { Object.keys(K).forEach(function (x) { localStorage.removeItem(K[x]); }); history.replaceState(null, '', location.pathname); }
    if (!/[?&]empty\b/.test(q) && !localStorage.getItem(K.meetings) && !localStorage.getItem(K.rosters)) seed();
    localStorage.setItem('rolltrack_onboarded', '1'); // skip the first-run tour on the demo
  } catch (e) { /* storage blocked: the demo still opens, just empty */ }

  document.addEventListener('DOMContentLoaded', function () {
    var bar = document.createElement('div');
    bar.id = 'rolltrack-demo-note';
    bar.setAttribute('style', 'position:fixed;left:12px;bottom:12px;z-index:40;max-width:340px;padding:10px 12px;border-radius:12px;font:12px/1.45 system-ui,sans-serif;color:#cbd5e1;background:rgba(15,19,27,.96);border:1px solid #2a3347;box-shadow:0 8px 24px rgba(0,0,0,.45)');
    bar.innerHTML = '<b style="color:#fff">Web demo, sample data.</b> Live meeting tracking needs the Chrome extension. Everything here stays in this browser. '
      + '<a href="?reset" style="color:#93c5fd">Reset demo</a> · <a href="#" id="rt-demo-x" style="color:#94a3b8">hide</a>';
    document.body.appendChild(bar);
    document.getElementById('rt-demo-x').addEventListener('click', function (e) { e.preventDefault(); bar.remove(); });
  });
})();
