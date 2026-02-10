// ==UserScript==
// @name         Download EPUB from fanfiction.net
// @namespace    http://tampermonkey.net/
// @description  Download stories from fanfiction.net as an EPUB file
// @author       brokeh
// @match        https://m.fanfiction.net/s/*
// @match        https://www.fanfiction.net/s/*
// @icon         https://www.fanfiction.net/favicon.ico
// @run-at       document-end
// @grant        GM.xmlHttpRequest
// @grant        GM_xmlhttpRequest
// @connect      www.fanfiction.net
// @connect      m.fanfiction.net
// ==/UserScript==

(function() {
    'use strict';

    var download_cancelled = false;
    var download_in_progress = false;

    function get_story_id() {
        return window.location.pathname.split('/')[2];
    }

    function regex_sub(str, regex, replacements) {
        const match = regex.exec(str);
        if (!match) {
            return null;
        }

        var final_str = str;
        const ordered_matches = Object.entries(match.indices.groups).sort((e) => e[1][0]).reverse();
        for (const [match_group, [match_span_start, match_span_end]] of ordered_matches) {
            const replacement = replacements[match_group];
            if (replacement !== undefined) {
                final_str = final_str.substring(0, match_span_start) + replacement + final_str.substring(match_span_end);
            }
        }
        return final_str;
    }

    function get_desktop_user_agent(user_agent) {
        /*
        Translates a mobile browser's user agent to a desktop one.
        Can't just use a hard-code one because the CloudFlare bot detection matches the known user agents to known TLS handshake signatures of that version, and if they don't match will reject the request

        tests:
            get_desktop_user_agent('Mozilla/5.0 (Android 15; Mobile; rv:145.0) Gecko/145.0 Firefox/145.0') == 'Mozilla/5.0 (X11; Linux x86_64; rv:145.0) Gecko/20100101 Firefox/145.0'
            get_desktop_user_agent('Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Mobile Safari/537.36') == 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36'
            get_desktop_user_agent('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Gecko/20100101 Firefox/147.0') == null
            get_desktop_user_agent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36') == null
        */

        // FireFox: Will transalate something like
        //     Mozilla/5.0 (Android 15; Mobile; rv:145.0) Gecko/145.0 Firefox/145.0
        // into
        //    Mozilla/5.0 (X11; Linux x86_64; rv:145.0) Gecko/20100101 Firefox/145.0
        const firefox_mobile = /Mozilla\/[0-9.]+ \((?<os_version>.*?; Mobile); .*?\) (?<gecko_version>Gecko\/[0-9.]+) Firefox\/[0-9.]+/d;
        const firefox_desktop = regex_sub(user_agent, firefox_mobile, {os_version: 'X11; Linux x86_64', gecko_version: 'Gecko/20100101'});
        if (firefox_desktop) {
            return firefox_desktop;
        }

        // Chrome: Will transalate something like
        //     Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Mobile Safari/537.36
        // into
        //    Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36
        // e.g. ''
        const chrome_mobile = /Mozilla\/[0-9.]+ \((?<os_version>.*?)\) AppleWebKit\/[0-9.]+ \(KHTML, like Gecko\) Chrome\/[0-9.]+(?<mobile_tag> Mobile) Safari\/[0-9.]+/d;
        const chrome_desktop = regex_sub(user_agent, chrome_mobile, {os_version: 'X11; Linux x86_64', mobile_tag: ''});
        if (chrome_desktop) {
            return chrome_desktop;
        }
    }

    function gm_fetch(url, request_desktop_site) {
        return new Promise((resolve, reject) => {
            let xmlhttpRequest_func;
            if (typeof GM !== 'undefined') {
                // GreaseMonkey
                xmlhttpRequest_func = GM.xmlHttpRequest; // eslint-disable-line no-undef
            } else {
                // TamperMonkey
                xmlhttpRequest_func = GM_xmlhttpRequest; // eslint-disable-line no-undef
            }
            var headers = {};
            if (request_desktop_site) {
                const desktop_user_agent = get_desktop_user_agent(navigator.userAgent);
                if (desktop_user_agent) {
                    headers['User-Agent'] = desktop_user_agent;
                }
            }
            xmlhttpRequest_func({
                method: 'GET',
                url: url,
                headers: headers,
                onload: (response) => resolve(response),
                onerror: (error) => reject(error),
                onabort: (error) => reject(error),
                ontimeout: (error) => reject(error),
            });
        });
    }

    async function handle_too_many_requests(url) {
        show_rate_limit_warning(true);
        var iframe = document.createElement('iframe');
        const ret = new Promise((resolve) => {
            iframe.onload = function() {
                if (!is_cloudflare_human_page(iframe.contentWindow.document)) {
                    var iframe_doc = iframe.contentWindow.document;
                    iframe.remove();
                    resolve(iframe_doc);
                }
            };
        });
        iframe.src = url;
        document.getElementById('rate-limit-bypass-container').appendChild(iframe);
        return ret;
    }

    async function fetch_page(url, request_desktop_site) {
        if (download_cancelled) {
            return null;
        }
        const response = await gm_fetch(url, request_desktop_site);
        if (response.status < 400) {
            const dom_parser = new DOMParser();
            return dom_parser.parseFromString(response.responseText, 'text/html');
        }
        if (download_cancelled) {
            return null;
        }
        if (response.status == 429) {
            return 429;
        }
        else {
            throw new Error(`Server returned error code ${response.status}.\n\n${response.responseText}`);
        }
    }

    async function fetch_chapters(book) {
        var all_success = true;
        for (var i = 0; i < book.chapters.length; ++i) {
            var chapter = book.chapters[i];
            if (chapter.contents !== null) {
                continue;
            }
            set_progress(`Fetching chapter ${i + 1}/${book.chapters.length}`);
            let chapter_doc;
            var page_parser = parse_chapter_mobile;
            try {
                // Download chapter texts from the mobile site because it's lighter weight and faster
                var page_url = make_url_mobile(chapter.num);
                chapter_doc = await fetch_page(page_url);
                if (chapter_doc === null) {
                    return false;
                }
                else if (typeof chapter_doc == 'number') {
                    if (chapter_doc == 429) {
                        if (window.location.host == 'www.fanfiction.net') {
                            page_parser = parse_chapter_desktop;
                            page_url = make_url_desktop(chapter.num);
                        }
                        chapter_doc = await handle_too_many_requests(page_url);
                    }
                }
            }
            catch (error) {
                chapter.error = error;
                console.error(`Error fetching chapter ${chapter.num}: `, error);
                save_book_to_cache(book);
                all_success = false;
                continue;
            }
            page_parser(chapter_doc, chapter);
        }
        show_rate_limit_warning(false);
        return all_success;
    }

    function make_url_desktop(chapter_num) {
        if (chapter_num <= 0 || chapter_num == null) {
            chapter_num = '';
        }
        return `https://www.fanfiction.net/s/${get_story_id()}/${chapter_num}`;
    }

    function make_url_mobile(chapter_num) {
        if (chapter_num <= 0 || chapter_num == null) {
            chapter_num = '';
        }
        return `https://m.fanfiction.net/s/${get_story_id()}/${chapter_num}`;
    }

    function extract_metadata_items(html_doc) {
        return html_doc.querySelector('#profile_top > span.xgray').innerText
            .split(' - ')
            .map((i) => i.trim().replace('  ', ' '));
    }

    function extract_named_metadata(metadata, key) {
        for (const item of metadata) {
            if (item.startsWith(`${key}:`)) {
                return item.substring(key.length + 1).trim();
            }
        }
        return null;
    }

    function extract_anonymous_metadata(metadata, index) {
        var matches = 0;
        for (const item of metadata) {
            if (!/^[[a-zA-Z]+:.+$/.test(item)) {
                if (matches == index) {
                    return item;
                }
                matches += 1;
            }
        }
        return null;
    }

    function set_progress(text) {
        document.getElementById('download-progress').innerText = text;
    }

    function show_rate_limit_warning(show) {
        document.getElementById('download-rate-limit-warning').style = show ? '' : 'display: none;';
    }

    function set_error(text) {
        document.getElementById('download-error').innerText = text;
    }

    function prepare_book_desktop(html_doc) {
        const timestamps = html_doc.querySelectorAll('#profile_top span[data-xutime]');
        const author_link = html_doc.querySelector('#profile_top > a.xcontrast_txt');
        const metadata = extract_metadata_items(html_doc);
        var author_url = new URL(author_link.href);
        author_url.hostname = 'www.fanfiction.net'; // in case we're parsing from m.fanfiction.net

        let published_timestamp, updated_timestamp = null;
        if (timestamps.length == 1) {
            published_timestamp = parseInt(timestamps[0].attributes['data-xutime'].value);
        }
        else {
            updated_timestamp = parseInt(timestamps[0].attributes['data-xutime'].value);
            published_timestamp = parseInt(timestamps[1].attributes['data-xutime'].value);
        }

        var book = {
            id: get_story_id(),
            source: make_url_desktop(),
            title: html_doc.querySelector('#profile_top > b.xcontrast_txt').innerText,
            blurb: html_doc.querySelector('#profile_top > div.xcontrast_txt').innerText,
            author: {
                name: author_link.innerText,
                link: author_url,
            },
            metadata: {
                category: Array.from(html_doc.querySelectorAll('#pre_story_links .lc-left a')).map((e) => e.innerText),
                rating: extract_named_metadata(metadata, 'Rated'),
                language: extract_anonymous_metadata(metadata, 0),
                genre: extract_anonymous_metadata(metadata, 1),
                characters: extract_anonymous_metadata(metadata, 2),
                chapters: extract_named_metadata(metadata, 'Chapters'),
                words: extract_named_metadata(metadata, 'Words'),
                reviews: extract_named_metadata(metadata, 'Reviews'),
                favs: extract_named_metadata(metadata, 'Favs'),
                follows: extract_named_metadata(metadata, 'Follows'),
            },
            updated_time: updated_timestamp,
            created_time: published_timestamp,
            download_time: Math.round(Date.now() / 1000),
            chapters: []
        }

        const first_chapter_selector = html_doc.getElementById('chap_select'); // There's a 2nd one with the same ID at the bottom of the page
        const current_chapter = parseInt(html_doc.getElementById('chap_select').value);

        for (const chapterSelect of first_chapter_selector.querySelectorAll('#chap_select > option')) {
            const chapter_num_str = chapterSelect.value;
            const chapter_num = parseInt(chapter_num_str);
            var chapter_title = chapterSelect.innerText;
            if (chapter_title.startsWith(chapter_num_str + '.')) {
                chapter_title = chapter_title.substring(chapter_num_str.length + 1).trim();
            }
            var chapter = {
                num: chapter_num,
                title: chapter_title,
                url: make_url_desktop(chapter_num),
                contents: null,
                error: null
            };
            if (chapter_num == current_chapter) {
                parse_chapter_desktop(html_doc, chapter);
            }
            book.chapters.push(chapter);
        }

        return book;
    }

    function parse_chapter_desktop(html_doc, chapter) {
        chapter.contents = html_doc.getElementById('storytext').innerHTML;
        chapter.error = null;
    }

    function parse_chapter_mobile(html_doc, chapter) {
        chapter.contents = html_doc.getElementById('storycontent').innerHTML;
        chapter.error = null;
    }

    function find_first_missing_chapter(book) {
        for (const chapter of book.chapters) {
            if (chapter.contents !== null) {
                return chapter;
            }
        }
        return null;
    }

    function load_book_from_cache() {
        const existing_book_str = localStorage.getItem('last-epub-download');
        if (existing_book_str != null) {
            const existing_book = JSON.parse(existing_book_str);
            if (existing_book.id == get_story_id()) {
                return existing_book;
            }
        }
        return null;
    }

    function save_book_to_cache(book) {
        localStorage.setItem('last-epub-download', JSON.stringify(book))
    }

    function merge_cached_chapters(book, cached_book) {
        for (var i = 0; i < Math.min(cached_book.chapters.length, book.chapters.length); ++i) {
            const cached_chapter = cached_book.chapters[i];
            if (cached_chapter.contents !== null) {
                book.chapters[i] = cached_chapter;
            }
        }
    }

    async function do_download() {
        var book;
        const existing_book = load_book_from_cache();
        if (window.location.host == 'm.fanfiction.net') {
            const first_missing_chapter = existing_book ? find_first_missing_chapter(existing_book) : null;
            const chapter_num = first_missing_chapter === null ? 1 : first_missing_chapter.num;
            const chapter_doc = await fetch_page(make_url_desktop(chapter_num), true);
            if (chapter_doc === null) {
                return false;
            }
            book = prepare_book_desktop(chapter_doc);
        } else if (window.location.host == 'www.fanfiction.net') {
            book = prepare_book_desktop(document);
        } else {
            set_error(`Unrecognised domain ${window.location.host}`);
            return false;
        }
        if (existing_book !== null) {
            merge_cached_chapters(book, existing_book);
        }
        const success = await fetch_chapters(book);
        save_book_to_cache(book);
        console.log(book);

        if (!success) {
            return false;
        }
        if (!convert_to_epub(book)) {
            return false;
        }
        return true;
    }

    async function download() {
        var dlg = document.getElementById('download-dialog');
        dlg.querySelector('#download-cancel-btn').innerText = 'Cancel';
        dlg.showModal();

        download_cancelled = false;
        download_in_progress = true;
        var res = false;
        try {
            res = await do_download();
        }
        catch (error) {
            set_error(`Download failed with an unhandled error: ${error}`);
        }
        download_in_progress = false;

        if (res || download_cancelled) {
            dlg.close();
        }
        else {
            dlg.querySelector('#download-cancel-btn').innerText = 'Close';
        }
    }

    function cancel_download() {
        download_cancelled = true;
        if (!download_in_progress) {
            var dlg = document.getElementById('download-dialog');
            dlg.close();
        }
    }

    function is_cloudflare_human_page(html_doc) {
        return html_doc.querySelector('.footer[role="contentinfo"]') != null;
    }

    function convert_to_epub(book) {
        set_progress('Converting to EPUB');
        if (build_epub === undefined) {
            set_error("Running from template script - can't convert to EPUB file");
            return false;
        }
        let epub_blob;
        try {
            epub_blob = build_epub(JSON.stringify(book));
        } catch (error) {
            set_error(error);
            return false;
        }
        const url = window.URL.createObjectURL(epub_blob);
        const elem = window.document.createElement('a');
        elem.href = url;
        elem.download = `${book.title}.epub`;
        document.body.appendChild(elem);
        elem.click();
        document.body.removeChild(elem);
        URL.revokeObjectURL(url);
        return true;
    }

    function add_download_button_desktop() {
        var download_btn = document.createElement('button');
        download_btn.classList.add('btn', 'pull-right', 'icon-arrow-down', 'download-btn-desktop');
        download_btn.innerText = ' Download';
        download_btn.addEventListener('click', download);

        var header = document.getElementById('profile_top');
        var follow_btn = header.querySelector('button.icon-heart');
        follow_btn.after(download_btn);
    }

    function add_download_button_mobile() {
        var download_btn = document.createElement('div');
        download_btn.classList.add('hbox', 'download-btn-mobile');
        download_btn.innerHTML = `<div class="t_text t_text_e"><?xml version='1.0' encoding='utf-8'?>
<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" version="1.1" viewBox="0 0 117.88 117.88" style="margin:-6px 0px">
	<g transform="translate(-8.1708 -170.16)">
		<rect x="8.1708" y="170.16" width="117.88" height="117.88" rx="5.3742" ry="5.3742" fill="#2183d7"/>
		<path d="m67.733 183.86c-2.8585 0-5.1598 2.2884-5.1598 5.1309v49.292l-15.509-16.921c-1.1154-1.2169-2.6192-1.8391-4.0977-1.8371-1.2251 2e-3 -2.4327 0.43171-3.3876 1.3069-2.1073 1.9315-2.2046 5.3179-0.1221 7.5031l23.253 24.4c3.6848 4.0526 5.7914 4.8877 10.047 8e-5l23.253-24.4c2.0825-2.1852 1.9851-5.5716-0.12217-7.5031-2.1073-1.9315-5.4457-1.695-7.4853 0.53024l-15.51 16.921v-49.292c0-2.8425-2.3013-5.1309-5.1598-5.1309z" fill="#fff"/>
		<path d="m109.25 238.21c-3.1468 0-5.6802 2.2904-5.6802 5.1354v18.599h-71.675v-18.464c0-2.845-2.5333-5.1354-5.6802-5.1354-3.1468 0-5.6802 2.2904-5.6802 5.1354v23.885c0 0.10685 4e-3 0.21282 0.01102 0.31801-0.0074 0.10348-0.01102 0.20771-0.01102 0.31255 0 3.3524 3.7938 6.0512 8.5063 6.0512h77.159c4.2428 0 7.7407-2.1876 8.396-5.0703 0.21645-0.54463 0.33455-1.1324 0.33455-1.746v-23.885c0-2.845-2.5334-5.1354-5.6802-5.1354z" fill="#f9f9f9"/>
	</g>
</svg></div>`;

        download_btn.addEventListener('click', download);

        var toolbar = document.querySelector('.t_head.hbox');
        var more_dropdown = toolbar.querySelector('.hbox:last-child');
        toolbar.insertBefore(download_btn, more_dropdown);
    }

    function add_download_dialog() {
        var download_dlg = document.createElement('dialog');
        download_dlg.id = 'download-dialog';
        download_dlg.innerHTML = `
        <h2>Downloading story</h2>
        <p id="download-progress">Preparing download...</p>
        <p id="download-rate-limit-warning" style="display: none;">
            Server is blocking because of too many requests.<br/>
            Download might slow down or ask you to verify you're human.
        </p>
        <p id="download-error"></p>
        <button id="download-cancel-btn">Cancel</button>
    `;
        download_dlg.querySelector('#download-cancel-btn').addEventListener('click', cancel_download);
        document.body.appendChild(download_dlg);
    }

    function add_rate_limit_bypass_container() {
        var container_wrapper = document.createElement('div');
        container_wrapper.id = 'rate-limit-bypass-container-wrapper';
        container_wrapper.classList.add('hidden');

        var container = document.createElement('div');
        container.id = 'rate-limit-bypass-container';
        container.classList.add('maxwidth');

        container_wrapper.appendChild(container);
        document.body.appendChild(container_wrapper);
    }

    function add_style_sheet() {
        var style_elem = document.createElement('style');
        style_elem.innerText = `
            #download-dialog {
                padding: 20px;
                border: 1px solid #ccc;
                border-radius: 8px;
                box-shadow: 0px 0px 12px 6px rgba(0, 0, 0, 0.4);
            }

            #download-dialog::backdrop {
                background-color: rgba(0, 0, 0, 0.5);
            }

            #download-rate-limit-warning {
                color: orange;
            }

            #download-error {
                color: red;
            }

            #download-dialog h2 {
                margin-top: 0;
            }

            #download-cancel-btn {
                margin-top: 15px;
                padding: 8px 16px;
                cursor: pointer;
                float: right;
            }

            .download-btn-desktop {
                margin-right: 6pt;
            }

            .download-btn-mobile {
                cursor: pointer;
            }

            #rate-limit-bypass-container-wrapper {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                z-index: 999;
            }

            #rate-limit-bypass-container-wrapper.hidden {
                z-index: -999;
            }

            body#top #rate-limit-bypass-container-wrapper.hidden {
                // mobile
                width: 1px;
                height: 1px;
            }

            #rate-limit-bypass-container {
                height: 100%;
            }

            #rate-limit-bypass-container iframe {
                width: 100%;
                height: 100%;
                border: none;
            }
        `;
        document.body.appendChild(style_elem);
    }

    function add_extra_page_elements() {
        if (is_cloudflare_human_page(document)) {
            return;
        }
        add_download_dialog();
        add_style_sheet();
        add_rate_limit_bypass_container();
        if (window.location.host == 'm.fanfiction.net') {
            add_download_button_mobile();
        } else if (window.location.host == 'www.fanfiction.net') {
            add_download_button_desktop();
        }
    }

    add_extra_page_elements();

    const wasm_b64 = '/* <<<EMBED BASE64 WASM MODULE HERE>>> */';
    /* <<<EMBED BINDINGS JS HERE>>> */

    // Check if wasm_bindgen has been embedded in the script, of if directly running the template in dev
    let build_epub;
    if (typeof wasm_bindgen !== 'undefined') {
        /* eslint-disable no-undef */
        ({ build_epub } = wasm_bindgen);
        wasm_bindgen(Uint8Array.from(atob(wasm_b64), c => c.charCodeAt(0)));
        /* eslint-enable no-undef */
    }
})();
