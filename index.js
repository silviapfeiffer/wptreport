#!/usr/bin/env node

var fs = require("fs-extra")
,   pth = require("path")
,   nopt = require("nopt")
,   cwd = process.cwd()
,   jn = pth.join
,   dn = __dirname
,   resDir = jn(dn, "res")
,   rfs = function (path) { return fs.readFileSync(path, "utf8"); }
,   wfs = function (path, content) { fs.writeFileSync(path, content, { encoding: "utf8" }); }
,   rjson = function (path) { return JSON.parse(rfs(path)); }
,   wjson = function (path, obj) { wfs(path, JSON.stringify(obj, null, 2)); }
,   tmpl = rfs(jn(resDir, "template.html"))
,   knownOpts = {
                    "input" :   String
                ,   "output" :  String
                ,   "help":     Boolean
                ,   "spec":     String
                ,   "version":  Boolean
                }
,   shortHands = {
                    "i":    ["--input"]
                ,   "o":    ["--output"]
                ,   "h":    ["--help"]
                ,   "s":    ["--spec"]
                ,   "v":    ["--version"]
                }
,   parsed = nopt(knownOpts, shortHands)
,   options = {
        input:      parsed.input || cwd
    ,   output:     parsed.output || cwd
    ,   help:       parsed.help || false
    ,   version:    parsed.version || false
    ,   spec:       parsed.spec || ""
    }
,   prefix = options.spec ? options.spec + ": " : ""
,   out = {
        ua: []
    ,   results: {}
    }
,   lessThanTwo = []
,   all = []
,   completeFail = []
,   err = function (str) {
        console.error("[ERROR] " + str);
        process.exit(1);
    }
,   esc = function (str) {
        if (!str) return str;
        return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }
,   interpolate = function (data) {
        return tmpl.replace(/\{\{(\w+)\}\}/g, function (m, p1) {
            return data[p1] !== undefined ? data[p1] : "@@@ERROR@@@";
        });
    }
,   cells = function (data) {
        var res = "";
        for (var i = 0, n = out.ua.length; i < n; i++) res += "<td class='" + data[out.ua[i]] + "'>" + esc(data[out.ua[i]]) + "</td>";
        return res;
    }
,   reports = []
,   consolidated = {}
,   totalSubtests = 0
,   uaPass = {}
,   tables = {}
,   copyFiles = "analysis.css jquery.min.js sticky-headers.js bootstrap.min.css".split(" ")
;

if (options.help) {
    console.log([
        "wptreport [--input /path/to/dir] [--output /path/to/dir] [--spec SpecName]"
    ,   ""
    ,   "   Generate nice-looking reports of various types based on test run reports coming"
    ,   "   out of Web Platform Tests."
    ,   ""
    ,   "   --input, -i  <directory> that contains all the JSON. JSON files must match the pattern"
    ,   "                \\w{2}\\d{d}\\.json. Defaults to the current directory."
    ,   "   --output, -o <directory> where the generated reports are stored. Defaults to the current"
    ,   "                directory."
    ,   "   --spec, -s SpecName to use in titling the report."
    ,   "   --help, -h to produce this message."
    ,   "   --version, -v to show the version number."
    ,   ""
    ].join("\n"));
    process.exit(0);
}

if (options.version) {
    console.log("wptreport " + require("./package.json").version);
    process.exit(0);
}

if (!fs.existsSync(options.input)) err("No input directory: " + options.input);
if (!fs.existsSync(options.output)) err("No output directory: " + options.output);

fs.readdirSync(options.input)
    .forEach(function (f) {
        if (!/^\w\w\d\d\.json$/.test(f)) return;
        reports.push(f);
        consolidated[f.replace(/\.json$/, "")] = JSON.parse(rfs(jn(options.input, f)));
    })
;

if (!reports.length) err("No JSON reports matching \\w\\w\\d\\d.json in input directory: " + options.input);

// consolidation
for (var agent in consolidated) {
    out.ua.push(agent);
    for (var i = 0, n = consolidated[agent].results.length; i < n; i++) {
        var testData = consolidated[agent].results[i]
        ,   id = testData.test
        ;
        if (!out.results[id]) {
            out.results[id] = {
                byUA:       {}
            ,   totals:     {}
            ,   subtests:   {}
            };
        }
        out.results[id].byUA[agent] = testData.status;
        if (!out.results[id].totals[testData.status]) out.results[id].totals[testData.status] = 1;
        else out.results[id].totals[testData.status]++;
        for (var j = 0, m = testData.subtests.length; j < m; j++) {
            var st = testData.subtests[j];
            if (!out.results[id].subtests[st.name]) out.results[id].subtests[st.name] = { byUA: {}, totals: {} };
            out.results[id].subtests[st.name].byUA[agent] = st.status;
            if (!out.results[id].subtests[st.name].totals[st.status]) out.results[id].subtests[st.name].totals[st.status] = 1;
            else out.results[id].subtests[st.name].totals[st.status]++;
        }
    }
}
wjson(jn(options.output, "consolidated.json"), out);

for (var i = 0, n = out.ua.length; i < n; i++) uaPass[out.ua[i]] = 0;

for (var test in out.results) {
    var run = out.results[test];
    var result = {
        status:     run.byUA
    ,   name:       test
    ,   fails:      []
    ,   subtests:   []
    ,   boom:       []
    ,   total:      0
    };
    for (var n in run.subtests) {
        result.total++;
        totalSubtests++;
        if (!run.subtests[n].totals.PASS || run.subtests[n].totals.PASS < 2) result.fails.push({ name: n, byUA: run.subtests[n].byUA });
        if (!run.subtests[n].totals.PASS) result.boom.push({ name: n, byUA: run.subtests[n].byUA });
        for (var i = 0, m = out.ua.length; i < m; i++) {
            var res = run.subtests[n].byUA[out.ua[i]];
            if (res === "PASS") uaPass[out.ua[i]]++;
        }
        result.subtests.push({ name: n, byUA: run.subtests[n].byUA });
    }
    if (result.fails.length) lessThanTwo.push(result);
    if (result.boom.length) completeFail.push(result);
    all.push(result);
}

var startTable = "<thead><tr class='persist-header'><th>Test</th><th>" + out.ua.join("</th><th>") + "</th></tr></thead>\n"
,   startToc = "<h3>Test Files</h3>\n<ol class='toc'>"
;

// DO ALL
(function () {
    var table = startTable
    ,   toc = startToc
    ,   subtests = 0
    ;
    for (var i = 0, n = all.length; i < n; i++) {
        var test = all[i];
        table += "<tr class='test' id='test-file-" + i + "'><td><a href='http://www.w3c-test.org" + esc(test.name) + "' target='_blank'>" +
                 esc(test.name) + "</a></td>" + cells(test.status) + "</tr>\n";
        toc += "<li><a href='#test-file-" + i + "'>" + esc(test.name) + "</a></li>";
        for (var j = 0, m = test.subtests.length; j < m; j++) {
            var st = test.subtests[j];
            subtests++;
            table += "<tr class='subtest'><td>" + esc(st.name) + "</td>" + cells(st.byUA) + "</tr>\n";
        }
    }
    table += "</table>";
    toc += "</ol>";

    var meta = "<p><strong>Test files</strong>: " + all.length + 
               "; <strong>Total subtests</strong>: " + subtests + "</p>" +
               "<h3>Per UA</h3>\n<dl>"
    ;
    var orderedUA = [].concat(out.ua).sort(function (a, b) {
        if (uaPass[a] > uaPass[b]) return -1;
        if (uaPass[a] < uaPass[b]) return 1;
        return 0;
    });
    for (var i = 0, n = orderedUA.length; i < n; i++) {
        var u = orderedUA[i];
        meta += "<dt>" + u + "</dt>\n" +
                "<dd>" + uaPass[u] + "/" + subtests + " (" + (100*uaPass[u]/subtests).toFixed(2) +"%)" + "</dd>\n";
    }
    meta += "</dl>";

    wfs(jn(options.output, "all.html")
    ,   interpolate({
            title: prefix + "All Results"
        ,   table: table
        ,   meta:  meta
        ,   toc:  toc
        })
    );    
}());

// DO LESS THAN 2
(function () {
    var table = startTable
    ,   toc = startToc
    ,   fails = 0
    ;
    for (var i = 0, n = lessThanTwo.length; i < n; i++) {
        var test = lessThanTwo[i]
        ,   details = "<small>(" + test.fails.length + "/" + test.total + ", " +
                     (100*test.fails.length/test.total).toFixed(2) + "%, " +
                     (100*test.fails.length/totalSubtests).toFixed(2) + "% of total)</small>"
        ;
        table += "<tr class='test' id='test-file-" + i + "'><td><a href='http://www.w3c-test.org" + esc(test.name) + "' target='_blank'>" +
                 esc(test.name) + "</a> " + details + "</td>" + cells(test.status) + "</tr>\n";
        toc += "<li><a href='#test-file-" + i + "'>" + esc(test.name) + "</a> " + details + "</li>";
        for (var j = 0, m = test.fails.length; j < m; j++) {
            var st = test.fails[j];
            fails++;
            table += "<tr class='subtest'><td>" + esc(st.name) + "</td>" + cells(st.byUA) + "</tr>\n";
        }
    }
    table += "</table>";
    toc += "</ol>";

    var meta = "<p><strong>Test files without 2 passes</strong>: " + lessThanTwo.length +
               "; <strong>Subtests without 2 passes: </strong>" + fails +
               "; <strong>Failure level</strong>: " + fails + "/" + totalSubtests + " (" +
               (100*fails/totalSubtests).toFixed(2) + "%)</p>"
    ;

    wfs(jn(options.output, "less-than-2.html")
    ,   interpolate({
            title: prefix + "Less Than 2 Passes"
        ,   table: table
        ,   meta:  meta
        ,   toc:  toc
        })
    );
}());


// COMPLETE FAILURES
(function () {
    var table = startTable
    ,   toc = startToc
    ,   fails = 0
    ;
    for (var i = 0, n = completeFail.length; i < n; i++) {
        var test = completeFail[i]
        ,   details = "<small>(" + test.boom.length + "/" + test.total + ", " +
                     (100*test.boom.length/test.total).toFixed(2) + "%, " +
                     (100*test.boom.length/totalSubtests).toFixed(2) + "% of total)</small>"
        ;
        table += "<tr class='test' id='test-file-" + i + "'><td><a href='http://www.w3c-test.org" + esc(test.name) + "' target='_blank'>" +
                 esc(test.name) + "</a> " + details + "</td>" + cells(test.status) + "</tr>\n";
        toc += "<li><a href='#test-file-" + i + "'>" + esc(test.name) + "</a> " + details + "</li>";
        for (var j = 0, m = test.boom.length; j < m; j++) {
            var st = test.boom[j];
            fails++;
            table += "<tr class='subtest'><td>" + esc(st.name) + "</td>" + cells(st.byUA) + "</tr>\n";
        }
    }
    table += "</table>";
    toc += "</ol>";

    var meta = "<p><strong>Completely failed files</strong>: " + lessThanTwo.length +
               "; <strong>Completely failed subtests</strong>: " + fails +
               "; <strong>Failure level</strong>: " + fails + "/" + totalSubtests + " (" +
               (100*fails/totalSubtests).toFixed(2) + "%)</p>"
    ;

    wfs(jn(options.output, "complete-fails.html")
    ,   interpolate({
            title: prefix + "Complete Failures"
        ,   table: table
        ,   meta:  meta
        ,   toc:  toc
        })
    );
}());

// copy resources over
copyFiles.forEach(function (f) {
    fs.copySync(jn(resDir, f), jn(options.output, f));
});
