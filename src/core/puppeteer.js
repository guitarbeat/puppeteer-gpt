"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.launchBrowser = void 0;
var puppeteer_extra_1 = require("puppeteer-extra");
var puppeteer_extra_plugin_stealth_1 = require("puppeteer-extra-plugin-stealth");
// Add stealth plugin
puppeteer_extra_1.default.use((0, puppeteer_extra_plugin_stealth_1.default)());
/**
 * Launch a puppeteer browser instance with stealth mode
 *
 * @param width  The width of the browser window. Default is `640`
 * @param height  The height of the browser window. Default is `480`
 * @param headless  If `true`, the browser will be launched in headless mode. Default is `true`
 * @param incognito  If `true`, the browser will be launched in incognito mode. Default is `false`
 * @param lang  The language of the browser. Default is `en-US`
 * @param args  Additional arguments to pass to the browser instance
 * @param options  Additional options to pass to the browser instance
 *
 * @returns The browser instance and the first page
 */
var launchBrowser = function (_a) { return __awaiter(void 0, void 0, void 0, function () {
    var browser, page;
    var _b = _a.width, width = _b === void 0 ? 640 : _b, _c = _a.height, height = _c === void 0 ? 480 : _c, _d = _a.headless, headless = _d === void 0 ? true : _d, _e = _a.incognito, incognito = _e === void 0 ? false : _e, _f = _a.lang, lang = _f === void 0 ? "en-US" : _f, _g = _a.args, args = _g === void 0 ? [] : _g, options = __rest(_a, ["width", "height", "headless", "incognito", "lang", "args"]);
    return __generator(this, function (_h) {
        switch (_h.label) {
            case 0: return [4 /*yield*/, puppeteer_extra_1.default.launch(__assign({ headless: headless, ignoreHTTPSErrors: true, timeout: 0, protocolTimeout: 0, defaultViewport: null, args: __spreadArray([
                        "--no-sandbox",
                        "--disable-setuid-sandbox",
                        "--disable-infobars",
                        "--ignore-certificate-errors",
                        "--ignore-certifcate-errors-spki-list",
                        "--window-size=".concat(width, ",").concat(height),
                        "--window-position=0,0",
                        "--mute-audio",
                        incognito ? "--incognito" : "",
                        lang ? "--lang=".concat(lang) : ""
                    ], args, true) }, options))];
            case 1:
                browser = _h.sent();
                return [4 /*yield*/, browser.pages()];
            case 2:
                page = (_h.sent())[0];
                // Set additional stealth configurations
                return [4 /*yield*/, page.setExtraHTTPHeaders({
                        'Accept-Language': 'en-US,en;q=0.9',
                    })];
            case 3:
                // Set additional stealth configurations
                _h.sent();
                // Set a realistic user agent
                return [4 /*yield*/, page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36')];
            case 4:
                // Set a realistic user agent
                _h.sent();
                page.setDefaultNavigationTimeout(0);
                return [2 /*return*/, {
                        browser: browser,
                        page: page,
                    }];
        }
    });
}); };
exports.launchBrowser = launchBrowser;
