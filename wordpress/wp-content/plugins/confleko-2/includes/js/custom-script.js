jQuery(document).ready(function ($) {
  $("#lup-recreate-thumbnails-btn").click(function (e) {
    e.preventDefault();

    var data = {
      action: "lup_recreate_thumbnails",
      post_id: $("#post_ID").val(), // Get the post ID from the hidden input field
      nonce: $("#lup_recreate_thumbnails_nonce").val(),
    };

    $.post(lupAjax.ajaxurl, data, function (response) {
      alert(response); // Display the response from the server
    });
  });
});
