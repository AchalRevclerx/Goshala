function alert_success(title) {
    $.toast({
        heading: 'Success',
        text: title,
        showHideTransition: 'slide',
        icon: 'success'
    })
}

function alert_danger(title) {
    $.toast({
        heading: 'Error',
        text: title,
        showHideTransition: 'slide',
        icon: 'error'
    })
}
