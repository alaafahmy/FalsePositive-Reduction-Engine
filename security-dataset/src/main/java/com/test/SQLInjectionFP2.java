package com.test;

/**
 * Classification  : FALSE POSITIVE
 * Vulnerability   : SQL Injection (CWE-089) — NOT EXPLOITABLE
 * Why safe        : The "sort" column name is validated against a strict
 *                   whitelist of known column names before being interpolated
 *                   into the ORDER BY clause.  PreparedStatement cannot be
 *                   used for column/table names, so whitelist is the correct
 *                   mitigation here.  Only whitelisted literals reach SQL.
 * CodeQL expected : MIGHT DETECT (taint still flows; whitelist may not be
 *                   recognised as a sanitiser by all tools)
 */
import java.io.IOException;
import java.io.PrintWriter;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.Arrays;
import java.util.List;
import javax.servlet.ServletException;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

public class SQLInjectionFP2 extends HttpServlet {

    private static final List<String> ALLOWED_COLUMNS =
            Arrays.asList("id", "username", "email", "created_at");

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp)
            throws ServletException, IOException {

        // SOURCE — looks risky (column name from user)
        String sortBy = req.getParameter("sort");
        String search = req.getParameter("q");

        PrintWriter out = resp.getWriter();

        // SAFE — whitelist validation: only known column names allowed
        if (sortBy == null || !ALLOWED_COLUMNS.contains(sortBy)) {
            sortBy = "id";  // safe default
        }

        try {
            Connection conn = DriverManager.getConnection(
                    "jdbc:mysql://localhost:3306/appdb", "root", "secret");

            // search value is safely parameterised; sortBy is whitelist-verified
            PreparedStatement ps = conn.prepareStatement(
                    "SELECT id, username FROM users WHERE email LIKE ? ORDER BY " + sortBy);
            ps.setString(1, "%" + search + "%");
            ResultSet rs = ps.executeQuery();

            while (rs.next()) {
                out.println(rs.getString("username"));
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
