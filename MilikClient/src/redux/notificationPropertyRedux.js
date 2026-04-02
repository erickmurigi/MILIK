// redux/notificationSlice.js
import { createSlice } from "@reduxjs/toolkit"

export const notificationSlice = createSlice({
    name: "notification",
    initialState: {
        notifications: [],
        isFetching: false,
        error: false
    },
    reducers: {
        // Get all notifications
        getNotificationsStart: (state) => {
            state.isFetching = true
            state.error = false
        },
        getNotificationsSuccess: (state, action) => {
            state.isFetching = false
            state.notifications = action.payload
        },
        getNotificationsFailure: (state) => {
            state.isFetching = false
            state.error = true
        },

        // Create notification
        createNotificationStart: (state) => {
            state.isFetching = true
            state.error = false
        },
        createNotificationSuccess: (state, action) => {
            state.isFetching = false
            state.notifications.push(action.payload)
        },
        createNotificationFailure: (state) => {
            state.isFetching = false
            state.error = true
        },

        // Update notification
        updateNotificationStart: (state) => {
            state.isFetching = true
            state.error = false
        },
        updateNotificationSuccess: (state, action) => {
            state.isFetching = false
            const index = state.notifications.findIndex((item) => item._id === action.payload._id)
            if (index !== -1) {
                state.notifications[index] = action.payload
            }
        },
        updateNotificationFailure: (state) => {
            state.isFetching = false
            state.error = true
        },

        // Delete notification
        deleteNotificationStart: (state) => {
            state.isFetching = true
            state.error = false
        },
        deleteNotificationSuccess: (state, action) => {
            state.isFetching = false
            state.notifications.splice(
                state.notifications.findIndex((item) => item._id === action.payload),
                1
            )
        },
        deleteNotificationFailure: (state) => {
            state.isFetching = false
            state.error = true
        },

        // Mark as read
        markNotificationAsReadStart: (state) => {
            state.isFetching = true
            state.error = false
        },
        markNotificationAsReadSuccess: (state, action) => {
            state.isFetching = false
            const index = state.notifications.findIndex((item) => item._id === action.payload._id)
            if (index !== -1) {
                state.notifications[index] = action.payload
            }
        },
        markNotificationAsReadFailure: (state) => {
            state.isFetching = false
            state.error = true
        },

        // Mark all as read
        markAllNotificationsAsReadStart: (state) => {
            state.isFetching = true
            state.error = false
        },
        markAllNotificationsAsReadSuccess: (state) => {
            state.isFetching = false
            state.notifications = state.notifications.map(notification => ({
                ...notification,
                isRead: true
            }))
        },
        markAllNotificationsAsReadFailure: (state) => {
            state.isFetching = false
            state.error = true
        }
    }
})

export const {
    getNotificationsStart,
    getNotificationsSuccess,
    getNotificationsFailure,
    createNotificationStart,
    createNotificationSuccess,
    createNotificationFailure,
    updateNotificationStart,
    updateNotificationSuccess,
    updateNotificationFailure,
    deleteNotificationStart,
    deleteNotificationSuccess,
    deleteNotificationFailure,
    markNotificationAsReadStart,
    markNotificationAsReadSuccess,
    markNotificationAsReadFailure,
    markAllNotificationsAsReadStart,
    markAllNotificationsAsReadSuccess,
    markAllNotificationsAsReadFailure
} = notificationSlice.actions

export default notificationSlice.reducer