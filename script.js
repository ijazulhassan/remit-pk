// RemitPK — v1
// Placeholder for affiliate click tracking. Replace href="#" values in
// index.html with your real affiliate tracking links (Wise, WorldRemit,
// Remitly) once your accounts are approved.

document.addEventListener('DOMContentLoaded', function () {
  var links = document.querySelectorAll('a[data-provider]');
  links.forEach(function (link) {
    link.addEventListener('click', function (e) {
      if (link.getAttribute('href') === '#') {
        e.preventDefault();
        console.log('Affiliate link not yet set for:', link.dataset.provider);
      }
      // Once real links are in place, this is where you could push an
      // analytics event, e.g.:
      // gtag('event', 'affiliate_click', { provider: link.dataset.provider });
    });
  });
});
