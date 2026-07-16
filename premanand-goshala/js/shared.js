/* ===== Shared Components — Premanand Gaushala ===== */
(function() {

/* ---- Social Sidebar ---- */
var socialSidebar = '<div class="social-sidebar">' +
    '<a href="#" target="_blank" class="whatsapp" title="WhatsApp"><i class="fa fa-whatsapp"></i></a>' +
    '<a href="#" target="_blank" class="facebook" title="Facebook"><i class="fa fa-facebook"></i></a>' +
    '<a href="#" target="_blank" class="instagram" title="Instagram"><i class="fa fa-instagram"></i></a>' +
    '<a href="#" target="_blank" class="youtube" title="YouTube"><i class="fa fa-youtube-play"></i></a>' +
    '</div>';

/* ---- Top Bar ---- */
var topBar = '<div class="top-bar d-none d-md-block">' +
    '<div class="container">' +
    '<div class="row align-items-center">' +
    '<div class="col-md-6 text-center text-md-left">' +
    '<i class="fa fa-phone" style="margin-right:5px;"></i> <span id="s-topbar-phone">+91-7000000000</span> &nbsp;|&nbsp; ' +
    '<i class="fa fa-envelope" style="margin-right:5px;"></i> <span id="s-topbar-email">info@premanandgaushala.org</span>' +
    '</div>' +
    '<div class="col-md-6 text-center text-md-right social-icons">' +
    '<a id="s-tb-fb" href="#"><i class="fa fa-facebook"></i></a> ' +
    '<a id="s-tb-tw" href="#"><i class="fa fa-twitter"></i></a> ' +
    '<a id="s-tb-ig" href="#"><i class="fa fa-instagram"></i></a> ' +
    '<a id="s-tb-yt" href="#"><i class="fa fa-youtube-play"></i></a>' +
    '</div></div></div></div>';

/* ---- Header ---- */
var header = '<header class="header-top">' +
    '<div class="container-fluid px-4">' +
    '<div class="logo-area">' +
    '<button class="hamburger-menu" onclick="toggleMobileNav()"><i class="fa fa-bars"></i></button>' +
    '<a href="index.html"><img src="images/logo.jpg" alt="Logo"></a>' +
    '<div class="site-title">श्री प्रेमानंद गौशाला<small>गौ सेवा ही मानव सेवा</small></div>' +
    '</div>' +
    '<div class="header-right">' +
    '<div class="social-icons">' +
    '<a id="s-hd-fb" href="#"><i class="fa fa-facebook-square"></i></a> ' +
    '<a id="s-hd-tw" href="#"><i class="fa fa-twitter-square"></i></a> ' +
    '<a id="s-hd-ig" href="#"><i class="fa fa-instagram"></i></a> ' +
    '<a id="s-hd-yt" href="#"><i class="fa fa-youtube-play"></i></a>' +
    '</div>' +
    '<a href="contact-us.html" class="enquiry-btn"><i class="fa fa-phone"></i> Enquiry Now</a>' +
    '</div></div></header>';

/* ---- Desktop Navigation ---- */
var desktopNav = '<nav class="nav-bar">' +
    '<div class="container">' +
    '<ul class="nav navbar-nav flex-row justify-content-center">' +
    '<li class="nav-item"><a class="nav-link" href="index.html"><i class="fa fa-home"></i> Home</a></li>' +
    '<li class="nav-item"><a class="nav-link" href="member-apply.html"><i class="fa fa-user-plus"></i> Member Apply</a></li>' +
    '<li class="nav-item"><a class="nav-link" href="id-card.html"><i class="fa fa-id-card"></i> ID Card Download</a></li>' +
    '<li class="nav-item"><a class="nav-link" href="events.html"><i class="fa fa-calendar"></i> Upcoming Event</a></li>' +
    '<li class="nav-item"><a class="nav-link" href="donation_form.html"><i class="fa fa-heart"></i> Donate</a></li>' +
    '<li class="nav-item"><a class="nav-link" href="donors.html"><i class="fa fa-list"></i> List of Donors</a></li>' +
    '<li class="nav-item"><a class="nav-link" href="gallery.html"><i class="fa fa-image"></i> Gallery</a></li>' +
    '<li class="nav-item"><a class="nav-link" href="contact-us.html"><i class="fa fa-phone"></i> Contact Us</a></li>' +
    '<li class="nav-item"><a class="nav-link" href="staff-search.html"><i class="fa fa-search"></i> Find Staff</a></li>' +
    '<li class="nav-item"><a class="nav-link" href="receipts.html"><i class="fa fa-receipt"></i> My Receipts</a></li>' +
    '<li class="nav-item dropdown">' +
    '<a class="nav-link dropdown-toggle" href="#" data-toggle="dropdown">About Us</a>' +
    '<div class="dropdown-menu">' +
    '<a class="dropdown-item" href="aboutus.html">About Us</a>' +
    '<a class="dropdown-item" href="#">Management Team</a>' +
    '<a class="dropdown-item" href="#">Working Staff</a>' +
    '<a class="dropdown-item" href="#">Our Team</a>' +
    '<a class="dropdown-item" href="#">Achievements</a>' +
    '<a class="dropdown-item" href="#">Certifications</a>' +
    '<a class="dropdown-item" href="#">Annual Report 3 Year</a>' +
    '<a class="dropdown-item" href="#">Audit Report 3 Year</a>' +
    '<a class="dropdown-item" href="#">ITR 3 Year</a>' +
    '<a class="dropdown-item" href="#">Memorandum</a>' +
    '</div></li>' +
    '<li class="nav-item dropdown">' +
    '<a class="nav-link dropdown-toggle" href="#" data-toggle="dropdown">Important Links</a>' +
    '<div class="dropdown-menu dropdown-menu-right">' +
    '<a class="dropdown-item" href="#">Crowdfunding</a>' +
    '<a class="dropdown-item" href="#">Our Solutions</a>' +
    '<a class="dropdown-item" href="#">Your Problems</a>' +
    '<a class="dropdown-item" href="#">Our Project</a>' +
    '<a class="dropdown-item" href="#">Geographical Location of Work</a>' +
    '<a class="dropdown-item" href="#">Projects Funding</a>' +
    '<a class="dropdown-item" href="#">Programs & Activities</a>' +
    '</div></li>' +
    '<li class="nav-item dropdown">' +
    '<a class="nav-link dropdown-toggle" href="#" data-toggle="dropdown"><i class="fa fa-sign-in"></i> Login</a>' +
    '<div class="dropdown-menu dropdown-menu-right">' +
    '<a class="dropdown-item" href="admin-login.html">Coordinator Login</a>' +
    '<a class="dropdown-item" href="admin-login.html">Manager Login</a>' +
    '</div></li>' +
    '</ul></div></nav>';

/* ---- Mobile Navigation ---- */
var mobileNav = '<div class="mobile-nav-overlay" id="mobileNavOverlay" onclick="toggleMobileNav()"></div>' +
    '<div class="mobile-nav" id="mobileNav">' +
    '<div class="mobile-nav-header">' +
    '<h5><i class="fa fa-cow"></i> श्री प्रेमानंद गोशाला</h5>' +
    '<button onclick="toggleMobileNav()"><i class="fa fa-times"></i></button>' +
    '</div>' +
    '<div class="mobile-nav-links">' +
    '<a href="index.html"><i class="fa fa-home"></i> Home</a>' +
    '<a href="member-apply.html"><i class="fa fa-user-plus"></i> Member Apply</a>' +
    '<a href="id-card.html"><i class="fa fa-id-card"></i> ID Card Download</a>' +
    '<a href="events.html"><i class="fa fa-calendar"></i> Upcoming Event</a>' +
    '<a href="donation_form.html"><i class="fa fa-heart"></i> Donate</a>' +
    '<a href="donors.html"><i class="fa fa-list"></i> List of Donors</a>' +
    '<a href="gallery.html"><i class="fa fa-image"></i> Gallery</a>' +
    '<a href="contact-us.html"><i class="fa fa-phone"></i> Contact Us</a>' +
    '<a href="staff-search.html"><i class="fa fa-search"></i> Find Staff</a>' +
    '<a href="receipts.html"><i class="fa fa-receipt"></i> My Receipts</a>' +
    '<div><a class="dropdown-toggle-nav" onclick="toggleMobileSubMenu(this)"><span><i class="fa fa-info-circle"></i> About Us</span><i class="fa fa-chevron-down"></i></a>' +
    '<div class="sub-menu">' +
    '<a href="aboutus.html">About Us</a>' +
    '<a href="#">Management Team</a><a href="#">Working Staff</a><a href="#">Our Team</a>' +
    '<a href="#">Achievements</a><a href="#">Certifications</a>' +
    '<a href="#">Annual Report 3 Year</a><a href="#">Audit Report 3 Year</a>' +
    '<a href="#">ITR 3 Year</a><a href="#">Memorandum</a>' +
    '</div></div>' +
    '<div><a class="dropdown-toggle-nav" onclick="toggleMobileSubMenu(this)"><span><i class="fa fa-link"></i> Important Links</span><i class="fa fa-chevron-down"></i></a>' +
    '<div class="sub-menu">' +
    '<a href="#">Crowdfunding</a><a href="#">Our Solutions</a><a href="#">Your Problems</a>' +
    '<a href="#">Our Project</a><a href="#">Geographical Location of Work</a>' +
    '<a href="#">Projects Funding</a><a href="#">Programs & Activities</a>' +
    '</div></div>' +
    '<div><a class="dropdown-toggle-nav" onclick="toggleMobileSubMenu(this)"><span><i class="fa fa-sign-in"></i> Login</span><i class="fa fa-chevron-down"></i></a>' +
    '<div class="sub-menu">' +
    '<a href="admin-login.html">Coordinator Login</a>' +
    '<a href="admin-login.html">Manager Login</a>' +
    '</div></div>' +
    '</div></div>';

/* ---- Footer ---- */
var footer = '<footer class="contact-footer">' +
    '<div class="container">' +
    '<div class="row">' +
    '<div class="col-lg-4 col-md-6 mb-4">' +
    '<div class="footer-logo">' +
    '<a href="index.html"><img src="images/logo.jpg" alt="Logo"></a>' +
    '<h5>श्री प्रेमानंद गोशाला</h5>' +
    '<p>गौ सेवा ही मानव सेवा के उद्देश्य के साथ समर्पित। हम बूढ़ी, बीमार और बेसहारा गायों की सेवा और संरक्षण के लिए प्रतिबद्ध हैं।</p>' +
    '</div>' +
    '<div class="footer-contact mt-3">' +
    '<p><i class="fa fa-map-marker"></i> <span id="s-ft-addr">गौशाला रोड, वृंदावन, जिला मथुरा, उत्तरप्रदेश - 281121</span></p>' +
    '<p><i class="fa fa-phone"></i> <span id="s-ft-phone">+91-7000000000, +91-7000000001</span></p>' +
    '<p><i class="fa fa-envelope"></i> <span id="s-ft-email">info@premanandgaushala.org</span></p>' +
    '</div></div>' +
    '<div class="col-lg-4 col-md-6 mb-4">' +
    '<h5>Useful Links</h5>' +
    '<div class="footer-links">' +
    '<a href="index.html"><i class="fa fa-angle-right"></i> Home</a>' +
    '<a href="member-apply.html"><i class="fa fa-angle-right"></i> Member Apply</a>' +
    '<a href="id-card.html"><i class="fa fa-angle-right"></i> ID Card Download</a>' +
    '<a href="events.html"><i class="fa fa-angle-right"></i> Upcoming Event</a>' +
    '<a href="donation_form.html"><i class="fa fa-angle-right"></i> Donate</a>' +
    '<a href="donors.html"><i class="fa fa-angle-right"></i> List of Donors</a>' +
    '<a href="gallery.html"><i class="fa fa-angle-right"></i> Gallery</a>' +
    '<a href="contact-us.html"><i class="fa fa-angle-right"></i> Contact Us</a>' +
    '<a href="aboutus.html"><i class="fa fa-angle-right"></i> About Us</a>' +
    '<a href="#"><i class="fa fa-angle-right"></i> Important Links</a>' +
    '<a href="#"><i class="fa fa-angle-right"></i> Login</a>' +
    '</div></div>' +
    '<div class="col-lg-4 col-md-6 mb-4">' +
    '<h5>Follow Us</h5>' +
    '<div class="footer-social">' +
    '<a id="s-ft-fb" href="#"><i class="fa fa-facebook"></i></a> ' +
    '<a id="s-ft-tw" href="#"><i class="fa fa-twitter"></i></a> ' +
    '<a id="s-ft-ig" href="#"><i class="fa fa-instagram"></i></a> ' +
    '<a id="s-ft-yt" href="#"><i class="fa fa-youtube-play"></i></a> ' +
    '<a id="s-ft-wa" href="#"><i class="fa fa-whatsapp"></i></a>' +
    '</div>' +
    '<div class="mt-4">' +
    '<h5>Donate Now</h5>' +
    '<p style="color:rgba(255,255,255,0.8);font-size:14px;">Your contribution helps us feed and care for our cows. Every donation matters!</p>' +
    '<a href="donation_form.html" class="enquiry-btn" style="background:var(--gold);"><i class="fa fa-heart"></i> Donate Now</a>' +
    '</div></div></div></div>' +
    '<div class="footer-bottom">' +
    '<div class="container">' +
    '<div class="row align-items-center">' +
    '<div class="col-md-6 text-center text-md-left mb-2 mb-md-0">' +
    'Copyright &copy; 2026, All Right Reserved <strong>श्री प्रेमानंद गोशाला</strong>' +
    '</div>' +
    '<div class="col-md-6 text-center text-md-right">' +
    '<a href="#">Terms &amp; Condition</a> &nbsp;|&nbsp; ' +
    '<a href="#">Privacy Policy</a> &nbsp;|&nbsp; ' +
    '<a href="#">Disclaimer</a> &nbsp;|&nbsp; ' +
    '<a href="#">Refund Policy</a>' +
    '</div></div>' +
    '<div class="row mt-2">' +
    '<div class="col-12 text-center" style="font-size:13px;color:rgba(255,255,255,0.6);">' +
    'Website Designed By - <a href="#" style="color:var(--gold);">Fragron Infotech</a>, Mob. - 7000131032' +
    '</div></div></div></div>' +
    '</footer>';

/* ---- Floating Action Buttons ---- */
var floatingButtons = '<div class="floating-buttons">' +
    '<a id="s-fl-wa" href="#" target="_blank" class="fb-whatsapp" title="WhatsApp"><i class="fa fa-whatsapp"></i></a>' +
    '<a href="donation_form.html" class="fb-donate" title="Donate"><i class="fa fa-heart"></i></a>' +
    '<a href="#" class="fb-problem"><i class="fa fa-exclamation-triangle"></i> Register Problem</a>' +
    '</div>';

/* ---- Inject HTML ---- */
document.addEventListener('DOMContentLoaded', function() {
    var body = document.body;
    var mainContent = document.getElementById('main-content');

    if (mainContent) {
        mainContent.insertAdjacentHTML('beforebegin', socialSidebar + topBar + header + desktopNav + mobileNav);
        mainContent.insertAdjacentHTML('afterend', footer + floatingButtons);
    } else {
        body.insertAdjacentHTML('afterbegin', socialSidebar + topBar + header + desktopNav + mobileNav);
        body.insertAdjacentHTML('beforeend', footer + floatingButtons);
    }

    /* ---- Receipts now public, no login required ---- */

    /* ---- AOS Init ---- */
    if (typeof AOS !== 'undefined') {
        AOS.init({ duration: 800, easing: 'ease-in-out', once: true });
    }

    /* ---- Active Page Highlighting ---- */
    var path = window.location.pathname;
    var page = path.split('/').pop();
    document.querySelectorAll('.nav-bar .navbar-nav .nav-link, .mobile-nav-links a').forEach(function(el) {
        var href = el.getAttribute('href');
        if (href === page || (page === '' && href === 'index.html')) {
            el.classList.add('active');
        }
    });

    /* ---- Load Dynamic Settings ---- */
    $.get('/api/settings?' + Date.now(), function(s) {
        if (!s) return;
        var phone = [s.phone, s.phone2].filter(Boolean).join(', ');
        if (s.whatsapp) $('.social-sidebar .whatsapp').attr('href', s.whatsapp);
        if (s.facebook) $('.social-sidebar .facebook').attr('href', s.facebook);
        if (s.instagram) $('.social-sidebar .instagram').attr('href', s.instagram);
        if (s.youtube) $('.social-sidebar .youtube').attr('href', s.youtube);
        if (phone) $('#s-topbar-phone').text(phone);
        if (s.email) $('#s-topbar-email').text(s.email);
        if (s.facebook) $('#s-tb-fb').attr('href', s.facebook);
        if (s.twitter) $('#s-tb-tw').attr('href', s.twitter);
        if (s.instagram) $('#s-tb-ig').attr('href', s.instagram);
        if (s.youtube) $('#s-tb-yt').attr('href', s.youtube);
        if (s.facebook) $('#s-hd-fb').attr('href', s.facebook);
        if (s.twitter) $('#s-hd-tw').attr('href', s.twitter);
        if (s.instagram) $('#s-hd-ig').attr('href', s.instagram);
        if (s.youtube) $('#s-hd-yt').attr('href', s.youtube);
        if (s.address) $('#s-address').text(s.address);
        if (phone) $('#s-phone').text(phone);
        if (s.email) $('#s-email').text(s.email);
        if (s.working_hours) $('#s-hours').text(s.working_hours);
        if (s.map_embed) $('#s-map').attr('src', s.map_embed);
        if (s.address) $('#s-ft-addr').text(s.address);
        if (phone) $('#s-ft-phone').text(phone);
        if (s.email) $('#s-ft-email').text(s.email);
        if (s.facebook) $('#s-ft-fb').attr('href', s.facebook);
        if (s.twitter) $('#s-ft-tw').attr('href', s.twitter);
        if (s.instagram) $('#s-ft-ig').attr('href', s.instagram);
        if (s.youtube) $('#s-ft-yt').attr('href', s.youtube);
        if (s.whatsapp) $('#s-ft-wa').attr('href', s.whatsapp);
        if (s.whatsapp) $('#s-fl-wa').attr('href', s.whatsapp);
    });
});

/* ---- Global Functions ---- */
window.toggleMobileNav = function() {
    $('#mobileNav').toggleClass('active');
    $('#mobileNavOverlay').toggleClass('active');
    $('body').toggleClass('overflow-hidden');
};

window.toggleMobileSubMenu = function(el) {
    $(el).next('.sub-menu').toggleClass('show');
    $(el).find('.fa-chevron-down').toggleClass('fa-chevron-up');
};

})();
