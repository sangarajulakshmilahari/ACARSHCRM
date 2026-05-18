export default function AccessDenied() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      
      <div className="bg-white shadow-xl rounded-2xl p-10 max-w-md w-full text-center">
        
        {/* Icon */}
        <div className="mx-auto mb-6 w-16 h-16 flex items-center justify-center rounded-full border-2 border-red-500">
          <div className="w-6 h-6 border-t-2 border-red-500 rotate-45"></div>
        </div>

        {/* Title */}
        <h1 className="text-2xl font-semibold text-red-600 mb-2">
          Access Denied
        </h1>

        {/* Subtitle */}
        <p className="text-gray-600 mb-6">
          You do not have permission to access this application.
        </p>

        {/* Divider */}
        <div className="border-t mb-6"></div>

        {/* Actions */}
        <div className="flex flex-col gap-3">
          
          <a
            href="/"
            className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition"
          >
            Back to Login
          </a>

          <a
            href="/ "
            className="w-full border border-gray-300 py-2 rounded-lg hover:bg-gray-50 transition"
          >
            Try Again
          </a>

        </div>

      </div>
    </div>
  );
}